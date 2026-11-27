'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ShareButton } from '@/components/ui/ShareButton';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  MapPin,
  Minus,
  Navigation,
  Package,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { estimateLocalDeliveryFee } from '@/lib/commerce/pricing-engine';
import type {
  CommercePaymentRail,
  ListingShopProfile,
  ShopHandoverMode,
  ShopOrder,
} from '@/lib/commerce/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';

export interface StorefrontProductItem {
  id: string;
  title: string;
  description: string | null;
  price: number;
  unit: string | null;
  unit_label: string | null;
  shop_category_tag: string | null;
  in_stock: boolean;
}

export interface ShopStorefrontClientProps {
  listingId: string;
  listingTitle: string;
  listingLocality: string;
  listingLat: number;
  listingLng: number;
  contactPhone: string | null;
  profile: ListingShopProfile;
  products: StorefrontProductItem[];
  hasActiveEntitlement: boolean;
  isModuleEnabled: boolean;
  canPayUpi?: boolean;
  canPayManual?: boolean;
  canDispatchPnd?: boolean;
  escrowRequired?: boolean;
}

export function ShopStorefrontClient({
  listingId,
  listingTitle,
  listingLocality,
  listingLat,
  listingLng,
  contactPhone,
  profile,
  products,
  hasActiveEntitlement,
  isModuleEnabled,
  canPayUpi = true,
  canPayManual = true,
  canDispatchPnd = true,
  escrowRequired = false,
}: ShopStorefrontClientProps) {
  const { user } = useAuth();
  const { setStatus } = useAppStatus();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [mountNowMs] = useState<number>(() => Date.now());

  // Basket: productId -> qty
  const [cart, setCart] = useState<Record<string, number>>({});
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const allowPickNDrop = Boolean(profile.allow_pick_n_drop && canDispatchPnd);
  const [handoverMode, setHandoverMode] = useState<ShopHandoverMode>(
    profile.allow_counter_pickup || !allowPickNDrop
      ? 'counter_pickup'
      : 'pick_n_drop'
  );
  const [paymentRail, setPaymentRail] = useState<CommercePaymentRail>(
    canPayUpi ? 'platform_escrow' : 'direct_counter'
  );
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [customerNote, setCustomerNote] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeIntent, setActiveIntent] = useState<PaymentIntentRecord | null>(
    null
  );
  const [pendingOrderDraft, setPendingOrderDraft] = useState<{
    order: ShopOrder;
    pickupOtp: string;
  } | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    order: ShopOrder;
    pickupOtp: string;
    shopUpi?: { upiId: string; payeeName: string; verified: boolean } | null;
  } | null>(null);
  const [copiedOtp, setCopiedOtp] = useState(false);

  const isBusyPaused = Boolean(
    profile.busy_until &&
      !Number.isNaN(Date.parse(profile.busy_until)) &&
      Date.parse(profile.busy_until) > mountNowMs
  );
  const canOrderOnline =
    isModuleEnabled &&
    hasActiveEntitlement &&
    profile.is_accepting_orders &&
    !isBusyPaused;

  // Pass V9-B & v21b: Deep-link ?item=<productId> smooth scroll + highlight, plus ?checkout=upi
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const itemParam = params.get('item')?.trim();
    const checkoutParam = params.get('checkout')?.trim().toLowerCase();
    if (!itemParam) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setHighlightedItemId(itemParam);
      if (checkoutParam === 'upi' && canOrderOnline) {
        setCart((prev) => (prev[itemParam] ? prev : { ...prev, [itemParam]: 1 }));
        setPaymentRail('platform_escrow');
        setIsCheckoutOpen(true);
      }
    });
    const el = document.querySelector<HTMLElement>(
      `[data-item-id="${CSS.escape(itemParam)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const timer = window.setTimeout(() => {
      if (active) setHighlightedItemId(null);
    }, 2500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canOrderOnline]);

  const categoryTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.shop_category_tag?.trim()) set.add(p.shop_category_tag.trim());
    }
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (inStockOnly && !p.in_stock) return false;
      if (selectedTag !== 'all' && p.shop_category_tag !== selectedTag) {
        return false;
      }
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.shop_category_tag || '').toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, selectedTag, inStockOnly]);

  const cartEntries = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ product: map.get(id), qty }))
      .filter(
        (e): e is { product: StorefrontProductItem; qty: number } =>
          Boolean(e.product)
      );
  }, [cart, products]);

  const totalItems = cartEntries.reduce((s, e) => s + e.qty, 0);
  const subtotalInr = cartEntries.reduce(
    (s, e) => s + e.product.price * e.qty,
    0
  );
  const effectiveHandoverMode: ShopHandoverMode = allowPickNDrop
    ? handoverMode
    : 'counter_pickup';

  const deliveryEst = useMemo(() => {
    if (effectiveHandoverMode !== 'pick_n_drop') return { distanceKm: 0, deliveryFeeInr: 0 };
    const lat = dropoffCoords?.lat ?? listingLat + 0.008;
    const lng = dropoffCoords?.lng ?? listingLng + 0.008;
    return estimateLocalDeliveryFee(listingLat, listingLng, lat, lng);
  }, [effectiveHandoverMode, dropoffCoords, listingLat, listingLng]);

  const packagingFeeInr = Math.max(0, Number(profile.packaging_fee_inr || 0));
  const totalAmountInr =
    subtotalInr + packagingFeeInr + deliveryEst.deliveryFeeInr;

  const directPayMax = Number(profile.payment_policy?.direct_pay_max_inr ?? 500);
  const forcesEscrow =
    canPayUpi &&
    (escrowRequired ||
      effectiveHandoverMode === 'pick_n_drop' ||
      !profile.payment_policy?.allow_direct_pay ||
      totalAmountInr > directPayMax ||
      !canPayManual);

  const effectiveRail: CommercePaymentRail = !canPayUpi
    ? 'direct_counter'
    : forcesEscrow
      ? 'platform_escrow'
      : !canPayManual && paymentRail === 'direct_counter'
        ? 'platform_escrow'
        : paymentRail;

  const meetsMinOrder = subtotalInr >= Number(profile.min_order_inr || 0);

  const adjustQty = (productId: string, delta: number) => {
    setCart((prev) => {
      const next = Math.max(0, Math.min(50, (prev[productId] || 0) + delta));
      if (next === 0) {
        const clone = { ...prev };
        delete clone[productId];
        return clone;
      }
      return { ...prev, [productId]: next };
    });
  };

  const handleUseCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    setStatus('locating', 'Detecting dropoff location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDropoffCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        if (!dropoffAddress.trim()) {
          setDropoffAddress(`Near ${listingLocality} (GPS pinned)`);
        }
        setStatus('success', 'Dropoff location pinned');
      },
      () => {
        setStatus('error', 'Could not detect GPS location');
      }
    );
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!user) {
      setErrorMsg('Please sign in to place your order.');
      return;
    }
    if (!meetsMinOrder) {
      setErrorMsg(`Minimum order amount is ₹${profile.min_order_inr}.`);
      return;
    }
    if (effectiveHandoverMode === 'pick_n_drop' && !dropoffAddress.trim()) {
      setErrorMsg('Please enter your delivery address for Pick N Drop.');
      return;
    }

    setIsSubmitting(true);
    setStatus('saving', 'Placing shop order...');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/commerce/shop-orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          listingId,
          items: cartEntries.map((c) => ({
            productId: c.product.id,
            qty: c.qty,
          })),
          handoverMode: effectiveHandoverMode,
          paymentRail: effectiveRail,
          dropoffAddress:
            effectiveHandoverMode === 'pick_n_drop'
              ? dropoffAddress.trim()
              : undefined,
          dropoffLat: dropoffCoords?.lat,
          dropoffLng: dropoffCoords?.lng,
          customerNote: customerNote.trim() || undefined,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        order?: ShopOrder;
        paymentIntent?: PaymentIntentRecord;
        pickupOtp?: string;
        shopUpi?: { upiId: string; payeeName: string; verified: boolean } | null;
        error?: string;
      };

      if (!res.ok || !json.order) {
        throw new Error(json.error || 'Could not place shop order.');
      }

      const otp = json.pickupOtp || json.order.pickup_otp_display_for_customer || '----';
      setIsCheckoutOpen(false);
      setCart({});

      if (json.paymentIntent) {
        setPendingOrderDraft({ order: json.order, pickupOtp: otp });
        setActiveIntent(json.paymentIntent);
        setStatus('idle');
      } else {
        setConfirmedOrder({
          order: json.order,
          pickupOtp: otp,
          shopUpi: json.shopUpi,
        });
        setStatus('success', 'Order confirmed!');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Order failed.';
      setErrorMsg(msg);
      setStatus('error', 'Order failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      data-testid="shop-storefront-client"
      className="rounded-2xl border border-sky-500/30 bg-[var(--ps-surface)] p-5 shadow-xs space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-extrabold text-[var(--ps-text)]">
                Storefront Catalogue
              </h2>
              {profile.store_verified && (
                <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                  <BadgeCheck className="h-3 w-3" />
                  Verified Store
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  canOrderOnline
                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                }`}
              >
                <Clock className="h-3 w-3" />
                {canOrderOnline
                  ? `Open · ~${profile.prep_time_mins}m prep`
                  : !hasActiveEntitlement
                    ? 'Showcase Only'
                    : 'Ordering Paused'}
              </span>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)]">
              {profile.allow_counter_pickup && 'Counter Pickup'}
              {profile.allow_counter_pickup && profile.allow_pick_n_drop && ' · '}
              {profile.allow_pick_n_drop && 'Pick N Drop Delivery'}
              {profile.min_order_inr > 0 && ` · Min order ₹${profile.min_order_inr}`}
            </p>
          </div>
        </div>
      </div>

      {/* Confirmed Order Card */}
      {confirmedOrder && (
        <div
          data-testid="shop-order-confirmed-card"
          className="rounded-2xl border border-emerald-500/35 bg-emerald-500/8 p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  Order Confirmed ·{' '}
                  <span className="font-mono">{confirmedOrder.order.order_code}</span>
                </p>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Share this 4-digit Pickup OTP at the counter (or with your rider).
                </p>
              </div>
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
                className="text-emerald-700 dark:text-emerald-300"
              >
                {copiedOtp ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {confirmedOrder.shopUpi && (
            <p className="text-xs text-[var(--ps-text)]">
              Direct Shop UPI:{' '}
              <strong className="font-mono">{confirmedOrder.shopUpi.upiId}</strong>{' '}
              ({confirmedOrder.shopUpi.payeeName})
            </p>
          )}

          <Link
            href="/activity?tab=commerce"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"
          >
            <span>Track in My Activity</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Search & Filters (Subscribed) */}
      {hasActiveEntitlement && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items in this store…"
              className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-3 text-xs"
            />
          </div>
          <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
            />
            <span>In Stock Only</span>
          </label>
          {categoryTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedTag('all')}
                className={`h-7 rounded-md px-2 text-[11px] font-bold ${
                  selectedTag === 'all'
                    ? 'bg-sky-600 text-white'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                All
              </button>
              {categoryTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag)}
                  className={`h-7 rounded-md px-2 text-[11px] font-bold ${
                    selectedTag === tag
                      ? 'bg-sky-600 text-white'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Product Grid (max 8 read-only if !hasActiveEntitlement) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(hasActiveEntitlement ? filteredProducts : products.slice(0, 8)).map(
          (prod) => {
            const qty = cart[prod.id] || 0;
            return (
              <div
                key={prod.id}
                data-item-id={prod.id}
                className={`rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 flex flex-col justify-between gap-2 transition-all duration-300 ${
                  !prod.in_stock ? 'opacity-60' : ''
                } ${
                  highlightedItemId === prod.id
                    ? 'ring-2 ring-[var(--ps-accent)] bg-[var(--ps-accent)]/8'
                    : ''
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-extrabold text-[var(--ps-text)] line-clamp-2">
                      {prod.title}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-xs font-extrabold text-sky-700 dark:text-sky-300 tabular-nums">
                        ₹{Math.round(prod.price).toLocaleString('en-IN')}
                      </span>
                      {canDispatchPnd && (
                        <Link
                          href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(listingId)}&itemId=${encodeURIComponent(prod.id)}&itemTitle=${encodeURIComponent(prod.title)}&serviceType=parcel`}
                          title={`Pick N Drop ${prod.title}`}
                          aria-label={`Book Pick N Drop for ${prod.title}`}
                          data-testid={`pnd-shop-item-${prod.id}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <Truck className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      )}
                      <ShareButton
                        compact
                        title={prod.title}
                        text={`${prod.title} (₹${Math.round(prod.price).toLocaleString('en-IN')}) at ${listingTitle} on DD oodle`}
                        url={`/listing/${encodeURIComponent(listingId)}?item=${encodeURIComponent(prod.id)}`}
                        label={`Share ${prod.title}`}
                        testId={`share-shop-item-${prod.id}`}
                        className="h-6 w-6"
                      />
                    </div>
                  </div>
                  <p className="mt-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    {prod.unit_label || prod.unit || 'Unit'}
                    {prod.shop_category_tag ? ` · ${prod.shop_category_tag}` : ''}
                  </p>
                  {prod.description && (
                    <p className="mt-1 text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                      {prod.description}
                    </p>
                  )}
                </div>

                {canOrderOnline && (
                  <div className="flex items-center justify-end pt-1">
                    {!prod.in_stock ? (
                      <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                        Out of Stock
                      </span>
                    ) : qty === 0 ? (
                      <button
                        type="button"
                        onClick={() => adjustQty(prod.id, 1)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-sky-600 hover:bg-sky-700 px-2.5 text-[11px] font-bold text-white"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add</span>
                      </button>
                    ) : (
                      <div className="inline-flex h-7 items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-1.5">
                        <button
                          type="button"
                          onClick={() => adjustQty(prod.id, -1)}
                          className="p-0.5 text-sky-700 dark:text-sky-300"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="font-mono text-xs font-extrabold tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjustQty(prod.id, 1)}
                          className="p-0.5 text-sky-700 dark:text-sky-300"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>

      {/* Free Basic Listing Call/Enquire Strip */}
      {!hasActiveEntitlement && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs">
          <span className="text-[var(--ps-text-muted)]">
            Showcase catalogue — call or enquire below to order directly from{' '}
            <strong className="text-[var(--ps-text)]">{listingTitle}</strong>.
          </span>
          {contactPhone && (
            <a
              href={`tel:${contactPhone.replace(/[^+\d]/g, '')}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-bold text-white"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Call Store</span>
            </a>
          )}
        </div>
      )}

      {/* Sticky Bottom Basket Bar */}
      {canOrderOnline && totalItems > 0 && (
        <div className="sticky bottom-16 lg:bottom-4 z-30 flex items-center justify-between gap-3 rounded-2xl border border-sky-500/40 bg-slate-950 px-4 py-3 text-white shadow-xl">
          <div>
            <p className="text-xs font-extrabold">
              {totalItems} {totalItems === 1 ? 'item' : 'items'} ·{' '}
              <span className="font-mono">
                ₹{Math.round(subtotalInr).toLocaleString('en-IN')}
              </span>
            </p>
            <p className="text-[10px] text-slate-300">
              {meetsMinOrder
                ? 'Ready for pickup or Pick N Drop checkout'
                : `Add ₹${Math.ceil(profile.min_order_inr - subtotalInr)} more to meet min order`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsCheckoutOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 px-4 text-xs font-extrabold text-slate-950"
          >
            <span>Checkout</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Checkout Sheet Modal (z-[88]) */}
      {isCheckoutOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => !isSubmitting && setIsCheckoutOpen(false)}
            className="fixed inset-0 z-[88] flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-xs"
          >
            <form
              onSubmit={handlePlaceOrder}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4 shadow-2xl text-xs"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2.5">
                <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                  Store Checkout · {listingTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCheckoutOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Handover Mode Toggle */}
              <div className={`grid gap-2 ${allowPickNDrop ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {(profile.allow_counter_pickup || !allowPickNDrop) && (
                  <button
                    type="button"
                    onClick={() => setHandoverMode('counter_pickup')}
                    className={`h-9 rounded-xl border px-3 font-bold inline-flex items-center justify-center gap-1.5 ${
                      effectiveHandoverMode === 'counter_pickup'
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                    }`}
                  >
                    <Store className="h-3.5 w-3.5" />
                    <span>Counter Pickup</span>
                  </button>
                )}
                {allowPickNDrop && (
                  <button
                    type="button"
                    onClick={() => setHandoverMode('pick_n_drop')}
                    className={`h-9 rounded-xl border px-3 font-bold inline-flex items-center justify-center gap-1.5 ${
                      effectiveHandoverMode === 'pick_n_drop'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span>Pick N Drop</span>
                  </button>
                )}
              </div>

              {effectiveHandoverMode === 'counter_pickup' && profile.pickup_instructions && (
                <p className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-[11px] text-[var(--ps-text-muted)]">
                  <strong className="text-[var(--ps-text)]">Pickup:</strong>{' '}
                  {profile.pickup_instructions}
                </p>
              )}

              {effectiveHandoverMode === 'pick_n_drop' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--ps-text)]">
                      Delivery Address *
                    </span>
                    <button
                      type="button"
                      onClick={handleUseCurrentLocation}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:underline"
                    >
                      <Navigation className="h-3 w-3" />
                      <span>Use GPS</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={dropoffAddress}
                    onChange={(e) => setDropoffAddress(e.target.value)}
                    placeholder="House no., Veng / Landmark, Street"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
                  />
                </div>
              )}

              {/* Dual-Rail Payment Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--ps-text)]">
                    Payment Method
                  </span>
                  {forcesEscrow && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                      Escrow Required (
                      {effectiveHandoverMode === 'pick_n_drop'
                        ? 'Rider Delivery'
                        : `> ₹${directPayMax}`}
                      )
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {canPayUpi && (
                    <button
                      type="button"
                      onClick={() => setPaymentRail('platform_escrow')}
                      className={`flex h-9 items-center justify-between rounded-xl border px-3 font-bold ${
                        effectiveRail === 'platform_escrow'
                          ? 'border-emerald-600 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        DD oodle Escrow (UPI / Razorpay)
                      </span>
                      {effectiveRail === 'platform_escrow' && (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  {(!forcesEscrow || !canPayUpi) && (
                    <>
                      {canPayManual && (
                        <button
                          type="button"
                          onClick={() => setPaymentRail('direct_counter')}
                          className={`flex h-9 items-center justify-between rounded-xl border px-3 font-bold ${
                            effectiveRail === 'direct_counter'
                              ? 'border-sky-600 bg-sky-500/10'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                          }`}
                        >
                          <span>Pay at Counter</span>
                          {effectiveRail === 'direct_counter' && (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      {canPayUpi && profile.payment_policy?.shop_upi_id && (
                        <button
                          type="button"
                          onClick={() => setPaymentRail('direct_shop_upi')}
                          className={`flex h-9 items-center justify-between rounded-xl border px-3 font-bold ${
                            effectiveRail === 'direct_shop_upi'
                              ? 'border-sky-600 bg-sky-500/10'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                          }`}
                        >
                          <span>Direct Shop UPI</span>
                          {effectiveRail === 'direct_shop_upi' && (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!canPayUpi && (
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Pay at Counter / direct settlement is available for this store.
                  </p>
                )}
              </div>

              <input
                type="text"
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                placeholder="Optional note for shopkeeper…"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
              />

              {/* Totals */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[var(--ps-text-muted)]">
                    Items Subtotal ({totalItems})
                  </span>
                  <span className="font-mono font-bold">
                    ₹{Math.round(subtotalInr).toLocaleString('en-IN')}
                  </span>
                </div>
                {packagingFeeInr > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ps-text-muted)]">
                      Packaging Fee
                    </span>
                    <span className="font-mono font-bold">
                      ₹{Math.round(packagingFeeInr).toLocaleString('en-IN')}
                    </span>
                  </div>
                )}
                {effectiveHandoverMode === 'pick_n_drop' && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ps-text-muted)]">
                      Pick N Drop Delivery (~{deliveryEst.distanceKm} km)
                    </span>
                    <span className="font-mono font-bold">
                      ₹{Math.round(deliveryEst.deliveryFeeInr).toLocaleString('en-IN')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-[var(--ps-border)] text-sm font-extrabold">
                  <span>Total</span>
                  <span className="font-mono text-sky-700 dark:text-sky-300">
                    ₹{Math.round(totalAmountInr).toLocaleString('en-IN')}
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
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-sky-600 font-bold text-white"
                >
                  Sign In to Place Order
                </Link>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting || !meetsMinOrder}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 font-bold text-white disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Package className="h-4 w-4" />
                  )}
                  <span>
                    {effectiveRail === 'platform_escrow'
                      ? `Pay ₹${Math.round(totalAmountInr).toLocaleString('en-IN')} via Escrow`
                      : 'Confirm Order'}
                  </span>
                </button>
              )}
            </form>
          </div>,
          document.body
        )}

      {/* UniversalPaymentModal (z-[90]) */}
      <UniversalPaymentModal
        open={Boolean(activeIntent)}
        intent={activeIntent}
        title={`Shop Order · ${listingTitle}`}
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

export default ShopStorefrontClient;
