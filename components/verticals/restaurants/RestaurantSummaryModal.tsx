'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  Flame,
  MessageCircle,
  Phone,
  ShieldCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import type { MenuDietType } from '@/lib/commerce/types';
import { supabase } from '@/lib/supabase/client';
import type { Listing } from '@/lib/types';

export interface RestaurantSummaryModalProps {
  listing: Listing;
  onClose: () => void;
  onOpenFullDetailPage: (listingId: string) => void;
}

interface PreviewDishRow {
  id: string;
  name: string;
  diet_type: MenuDietType;
  base_price_inr: number;
  is_bestseller: boolean;
}

export function DietIndicatorSquare({ diet }: { diet: MenuDietType }) {
  const tone =
    diet === 'veg'
      ? 'border-emerald-600 text-emerald-600'
      : diet === 'egg'
        ? 'border-amber-600 text-amber-600'
        : 'border-rose-600 text-rose-600';
  const dot =
    diet === 'veg'
      ? 'bg-emerald-600'
      : diet === 'egg'
        ? 'bg-amber-500'
        : 'bg-rose-600';

  return (
    <span
      title={
        diet === 'veg' ? 'Veg' : diet === 'egg' ? 'Contains Egg' : 'Non-Veg'
      }
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    </span>
  );
}

export function RestaurantSummaryModal({
  listing,
  onClose,
  onOpenFullDetailPage,
}: RestaurantSummaryModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [dishes, setDishes] = useState<PreviewDishRow[]>([]);
  const [profile, setProfile] = useState<{
    cuisines: string[];
    prep_time_mins: number;
    is_kitchen_open: boolean;
    allow_table_booking: boolean;
    fssai_verified: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    Promise.all([
      supabase
        .from('listing_restaurant_profiles')
        .select(
          'cuisines, prep_time_mins, is_kitchen_open, allow_table_booking, fssai_verified'
        )
        .eq('listing_id', listing.id)
        .maybeSingle(),
      supabase
        .from('restaurant_menu_items')
        .select('id, name, diet_type, base_price_inr, is_bestseller')
        .eq('listing_id', listing.id)
        .eq('in_stock', true)
        .order('is_bestseller', { ascending: false })
        .order('sort_order', { ascending: true })
        .limit(6),
    ])
      .then(([profRes, menuRes]) => {
        if (!active) return;
        if (profRes.data) {
          const p = profRes.data as Record<string, unknown>;
          setProfile({
            cuisines: Array.isArray(p.cuisines)
              ? p.cuisines.map((c) => String(c))
              : ['Local'],
            prep_time_mins: Number(p.prep_time_mins || 25),
            is_kitchen_open: p.is_kitchen_open !== false,
            allow_table_booking: Boolean(p.allow_table_booking),
            fssai_verified: Boolean(p.fssai_verified),
          });
        }
        if (Array.isArray(menuRes.data)) {
          setDishes(
            (menuRes.data as Array<Record<string, unknown>>).map((row) => ({
              id: String(row.id),
              name: String(row.name || 'Dish'),
              diet_type: (row.diet_type as MenuDietType) || 'non_veg',
              base_price_inr: Number(row.base_price_inr || 0),
              is_bestseller: Boolean(row.is_bestseller),
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

  const positivePrices = dishes
    .map((d) => d.base_price_inr)
    .filter((p) => p > 0);
  const minDishPrice =
    positivePrices.length > 0 ? Math.min(...positivePrices) : 0;

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
    liveCaps.canOrderFood && (profile?.is_kitchen_open ?? true);

  return (
    <ListingSummarySheetShell
      listing={listing}
      onClose={onClose}
      testId="restaurant-summary-modal"
      ariaLabel={`Menu preview for ${listing.title}`}
      categoryLabel={profile?.cuisines?.[0] || 'Restaurant & Café'}
      shareVerticalBadge="Food & Dining"
      sharePriceLabel={
        minDishPrice > 0
          ? `Menu from ₹${Math.round(minDishPrice).toLocaleString('en-IN')}`
          : null
      }
      isVerifiedOverride={Boolean(
        profile?.fssai_verified ||
          listing.is_verified ||
          listing.verificationStatus === 'verified_demo'
      )}
      verticalBadgeSlot={
        <>
          <span className="inline-flex items-center gap-1 rounded-md bg-orange-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
            <UtensilsCrossed className="h-3 w-3" />
            Restaurant &amp; Café
          </span>
          {profile?.fssai_verified && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-600/95 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs backdrop-blur-sm">
              <ShieldCheck className="h-3 w-3" />
              FSSAI ✓
            </span>
          )}
        </>
      }
      priceHighlight={
        minDishPrice > 0 ? (
          <span className="font-mono text-sm font-extrabold text-orange-700 dark:text-orange-300 tabular-nums shrink-0">
            From ₹{Math.round(minDishPrice).toLocaleString('en-IN')}
          </span>
        ) : null
      }
      identityExtraSlot={
        profile ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-orange-500" />
              ~{profile.prep_time_mins}m prep ETA
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                profile.is_kitchen_open
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
              }`}
            >
              {profile.is_kitchen_open ? 'Kitchen Open' : 'Kitchen Paused'}
            </span>
          </div>
        ) : null
      }
      quickActionsSlot={
        whatsappUrl || listing.contactPhone?.trim() || profile?.allow_table_booking ? (
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
            {profile?.allow_table_booking && (
              <Link
                href={`/listing/${encodeURIComponent(listing.id)}#reserve-table`}
                onClick={onClose}
                className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
              >
                <CalendarDays className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <span>Book Table</span>
              </Link>
            )}
          </div>
        ) : null
      }
      footerSlot={
        <div className="flex items-center gap-2">
          <Link
            href={`/listing/${encodeURIComponent(listing.id)}`}
            onClick={onClose}
            data-testid="restaurant-summary-primary-cta"
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-orange-700"
          >
            <span>{canOrderNow ? 'Menu & Order' : 'View Full Menu'}</span>
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
        {/* Cuisine Pills */}
        {profile && profile.cuisines.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {profile.cuisines.slice(0, 5).map((c) => (
              <span
                key={c}
                className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Popular Dishes */}
        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <Flame className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
            Popular Dishes
          </span>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-11 dd-shimmer rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]"
                />
              ))}
            </div>
          ) : dishes.length === 0 ? (
            <p className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text-muted)]">
              Open the full digital menu to browse today&apos;s dishes.
            </p>
          ) : (
            <div className="space-y-1.5">
              {dishes.map((dish) => (
                <div
                  key={dish.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <DietIndicatorSquare diet={dish.diet_type} />
                    <span className="font-bold text-[var(--ps-text)] truncate">
                      {dish.name}
                    </span>
                    {dish.is_bestseller && (
                      <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-extrabold uppercase text-amber-800 dark:text-amber-300 shrink-0">
                        Best
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-extrabold text-orange-700 dark:text-orange-300 shrink-0 tabular-nums">
                    ₹{Math.round(dish.base_price_inr).toLocaleString('en-IN')}
                  </span>
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
          listingVertical="restaurant_food"
          compact
        />
      </div>
    </ListingSummarySheetShell>
  );
}

export default RestaurantSummaryModal;
