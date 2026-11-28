'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  MessageCircle,
  Package,
  Phone,
  ShoppingBag,
  Store,
  Truck,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
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
  onOpenFullDetailPage,
}: ShopSummaryModalProps) {
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

  const positivePrices = products.map((p) => p.price).filter((p) => p > 0);
  const minPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : 0;

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

  const canOrderNow =
    liveCaps.canOrderShop && (profile?.is_accepting_orders ?? true);

  return (
    <ListingSummarySheetShell
      listing={listing}
      onClose={onClose}
      testId="shop-summary-modal"
      ariaLabel={`Storefront preview for ${listing.title}`}
      categoryLabel="Local Storefront"
      shareVerticalBadge="Local Shop"
      sharePriceLabel={
        minPrice > 0
          ? `From ₹${Math.round(minPrice).toLocaleString('en-IN')}`
          : null
      }
      isVerifiedOverride={Boolean(
        profile?.store_verified ||
          listing.is_verified ||
          listing.verificationStatus === 'verified_demo'
      )}
      verticalBadgeSlot={
        <>
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
            <ShoppingBag className="h-3 w-3" />
            Local Storefront
          </span>
          {profile?.store_verified && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-600/95 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs backdrop-blur-sm">
              <BadgeCheck className="h-3 w-3" />
              Verified Store
            </span>
          )}
        </>
      }
      priceHighlight={
        minPrice > 0 ? (
          <span className="font-mono text-sm font-extrabold text-sky-700 dark:text-sky-300 tabular-nums shrink-0">
            From ₹{Math.round(minPrice).toLocaleString('en-IN')}
          </span>
        ) : null
      }
      identityExtraSlot={
        profile ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-sky-500" />
              ~{profile.prep_time_mins}m pack &amp; prep
            </span>
          </div>
        ) : null
      }
      quickActionsSlot={
        listing.contactPhone?.trim() || whatsappUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            {listing.contactPhone?.trim() && (
              <a
                href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
                className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
              >
                <Phone className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Call</span>
              </a>
            )}
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
          </div>
        ) : null
      }
      footerSlot={
        <div className="flex items-center gap-2">
          <Link
            href={`/listing/${encodeURIComponent(listing.id)}`}
            onClick={onClose}
            data-testid="shop-summary-primary-cta"
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-sky-700"
          >
            <span>{canOrderNow ? 'Browse Shop & Order' : 'Open Storefront'}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFullDetailPage(listing.id);
            }}
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
          >
            <span>Open Full Details</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Accepted Handover Badges */}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {(profile?.allow_counter_pickup ?? true) && (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text)]">
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
                  className="h-14 dd-shimmer rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]"
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
      </div>
    </ListingSummarySheetShell>
  );
}

export default ShopSummaryModal;
