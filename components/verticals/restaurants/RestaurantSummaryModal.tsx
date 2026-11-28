'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import { useModalLock } from '@/hooks/useModalLock';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  Flame,
  MapPin,
  MessageCircle,
  Share2,
  ShieldCheck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useShare } from '@/components/ui/ShareSheetModal';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { SummaryMediaStrip } from '@/components/verticals/SummaryMediaStrip';
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
      title={diet === 'veg' ? 'Veg' : diet === 'egg' ? 'Contains Egg' : 'Non-Veg'}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    </span>
  );
}

export function RestaurantSummaryModal({
  listing,
  onClose,
}: RestaurantSummaryModalProps) {
  const isHydrated = useHydrated();
  const { openShareSheet } = useShare();
  useModalLock(true, onClose);

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

  if (!isHydrated || typeof document === 'undefined') return null;

  const minDishPrice =
    dishes.length > 0
      ? Math.min(...dishes.map((d) => d.base_price_inr).filter((p) => p > 0))
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
      aria-label={`Menu preview for ${listing.title}`}
      data-testid="restaurant-summary-modal"
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
              <span className="inline-flex items-center gap-1 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-orange-800 dark:text-orange-300">
                <UtensilsCrossed className="h-3 w-3" />
                Restaurant &amp; Café
              </span>
              {profile?.fssai_verified && (
                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  FSSAI ✓
                </span>
              )}
              {profile && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                  <Clock className="h-3 w-3" />
                  ~{profile.prep_time_mins}m ETA
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
                  text: `View menu and order from ${listing.title} in ${listing.locality} on DD oodle`,
                  url: `/listing/${encodeURIComponent(listing.id)}`,
                  imageUrl: listing.coverImage || null,
                  verticalBadge: 'Food & Dining',
                  categoryLabel: profile?.cuisines?.[0] || 'Restaurant',
                  locality: listing.locality,
                  priceLabel:
                    minDishPrice > 0
                      ? `Menu from ₹${Math.round(minDishPrice).toLocaleString('en-IN')}`
                      : null,
                  rating: listing.rating > 0 ? listing.rating : null,
                  isVerified: Boolean(
                    profile?.fssai_verified ||
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
              aria-label="Close restaurant summary"
              className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3.5">
          <SummaryMediaStrip listing={listing} onNavigate360={onClose} />
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
                    className="h-11 dd-shimmer rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]"
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

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
              >
                <MessageCircle className="h-4 w-4" />
                <span>WhatsApp</span>
              </a>
            )}
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}`}
              onClick={onClose}
              data-testid="restaurant-summary-primary-cta"
              className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-orange-700"
            >
              <span>
                {liveCaps.canOrderFood && (profile?.is_kitchen_open ?? true)
                  ? 'Menu & Order'
                  : 'Open Full Page'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
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
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default RestaurantSummaryModal;

