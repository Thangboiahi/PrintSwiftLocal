'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import { useModalLock } from '@/hooks/useModalLock';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  Share2,
  ShoppingBag,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { useShare } from '@/components/ui/ShareSheetModal';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { SummaryMediaStrip } from '@/components/verticals/SummaryMediaStrip';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import { supabase } from '@/lib/supabase/client';
import type { Listing } from '@/lib/types';

export interface ShopSummaryModalProps {
  listing: Listing;
  onClose: () => void;
  onOpenFullDetailPage: (listingId: string) => void;
}

interface PreviewProductRow {
  id: string;
  title: string;
  price: number;
  unit?: string | null;
  unit_label?: string | null;
}

export function ShopSummaryModal({
  listing,
  onClose,
}: ShopSummaryModalProps) {
  const isHydrated = useHydrated();
  const { openShareSheet } = useShare();
  useModalLock(true, onClose);

  const [isLoading, setIsLoading] = useState(true);
  const [products, setProducts] = useState<PreviewProductRow[]>([]);
  const [profile, setProfile] = useState<{
    is_accepting_orders: boolean;
    allow_counter_pickup: boolean;
    allow_pick_n_drop: boolean;
    prep_time_mins: number;
    store_verified: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    Promise.all([
      supabase
        .from('listing_shop_profiles')
        .select(
          'is_accepting_orders, allow_counter_pickup, allow_pick_n_drop, prep_time_mins, store_verified'
        )
        .eq('listing_id', listing.id)
        .maybeSingle(),
      supabase
        .from('marketplace_products')
        .select('id, title, price, unit, unit_label')
        .eq('listing_id', listing.id)
        .eq('is_active', true)
        .eq('in_stock', true)
        .order('sort_order', { ascending: true })
        .limit(6),
    ])
      .then(([profRes, prodRes]) => {
        if (!active) return;
        if (profRes.data) {
          const p = profRes.data as Record<string, unknown>;
          setProfile({
            is_accepting_orders: p.is_accepting_orders !== false,
            allow_counter_pickup: p.allow_counter_pickup !== false,
            allow_pick_n_drop: p.allow_pick_n_drop !== false,
            prep_time_mins: Number(p.prep_time_mins || 15),
            store_verified: Boolean(p.store_verified),
          });
        }
        if (Array.isArray(prodRes.data)) {
          setProducts(
            (prodRes.data as Array<Record<string, unknown>>).map((row) => ({
              id: String(row.id),
              title: String(row.title || 'Item'),
              price: Number(row.price || 0),
              unit: row.unit ? String(row.unit) : null,
              unit_label: row.unit_label ? String(row.unit_label) : null,
            }))
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [listing.id]);

  if (!isHydrated || typeof document === 'undefined') return null;

  const minPrice =
    products.length > 0
      ? Math.min(...products.map((p) => p.price).filter((p) => p > 0))
      : 0;

  const liveCaps = resolveListingLiveCapabilities(listing);
  const whatsappUrl =
    listing.whatsapp || listing.contactPhone
      ? buildContextualWhatsAppUrl(
          listing.whatsapp || listing.contactPhone || '',
          {
            type: 'listing_enquiry',
            listingTitle: listing.title,
            locality: listing.locality,
            url:
              typeof window !== 'undefined'
                ? `${window.location.origin}/listing/${encodeURIComponent(listing.id)}`
                : `/listing/${encodeURIComponent(listing.id)}`,
          }
        )
      : null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Storefront preview for ${listing.title}`}
      data-testid="shop-summary-modal"
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-sky-800 dark:text-sky-300">
                <ShoppingBag className="h-3 w-3" />
                Local Storefront
              </span>
              {profile?.store_verified && (
                <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                  <BadgeCheck className="h-3 w-3" />
                  Verified Store
                </span>
              )}
              {profile && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                  <Clock className="h-3 w-3" />
                  ~{profile.prep_time_mins}m prep
                </span>
              )}
            </div>
            <h3 className="mt-1 text-sm font-extrabold text-[var(--ps-text)] line-clamp-2">
              {listing.title}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
              <MapPin className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
              <span className="truncate">{listing.locality}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                openShareSheet({
                  title: listing.title,
                  text: `Browse ${listing.title} in ${listing.locality} on DD oodle`,
                  url: `/listing/${encodeURIComponent(listing.id)}`,
                  imageUrl: listing.coverImage || null,
                  verticalBadge: 'Local Shop',
                  categoryLabel: 'Storefront',
                  locality: listing.locality,
                  priceLabel:
                    minPrice > 0
                      ? `From ₹${Math.round(minPrice).toLocaleString('en-IN')}`
                      : null,
                  rating: listing.rating > 0 ? listing.rating : null,
                  isVerified: Boolean(
                    profile?.store_verified ||
                      listing.is_verified ||
                      listing.verificationStatus === 'verified_demo'
                  ),
                })
              }
              aria-label={`Share ${listing.title}`}
              className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close storefront summary"
              className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3.5">
          <SummaryMediaStrip listing={listing} onNavigate360={onClose} />
          {/* Accepted Handover Badges */}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            {(profile?.allow_counter_pickup ?? true) && (
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                <Store className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                Counter Pickup
              </span>
            )}
            {(profile?.allow_pick_n_drop ?? true) && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-800 dark:text-emerald-300">
                <Truck className="h-3 w-3" />
                Pick N Drop Delivery
              </span>
            )}
          </div>

          {/* Top 6 In-Stock Showcase Items */}
          <div className="space-y-2">
            <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
              <Package className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              In-Stock Showcase
            </span>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 dd-shimmer rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]"
                  />
                ))}
              </div>
            ) : products.length === 0 ? (
              <p className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text-muted)]">
                Open the full storefront to browse items and availability.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {products.map((prod) => (
                  <div
                    key={prod.id}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 flex flex-col justify-between gap-1"
                  >
                    <p className="text-xs font-bold text-[var(--ps-text)] line-clamp-1">
                      {prod.title}
                    </p>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-[var(--ps-text-muted)] truncate">
                        {prod.unit_label || prod.unit || 'Unit'}
                      </span>
                      <span className="font-mono font-extrabold text-sky-700 dark:text-sky-300 tabular-nums">
                        ₹{Math.round(prod.price).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DynamicListingLocationMap
            listingId={listing.id}
            title={listing.title}
            locality={listing.locality}
            address={listing.address}
            coordinates={listing.coordinates}
            listingVertical="shop_catalogue"
            compact
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
              >
                <MessageCircle className="h-4 w-4" />
                <span>WhatsApp</span>
              </a>
            )}
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}`}
              onClick={onClose}
              data-testid="shop-summary-primary-cta"
              className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-sky-700"
            >
              <span>
                {liveCaps.canOrderShop && (profile?.is_accepting_orders ?? true)
                  ? 'Browse Shop & Order'
                  : 'Open Full Page'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default ShopSummaryModal;

