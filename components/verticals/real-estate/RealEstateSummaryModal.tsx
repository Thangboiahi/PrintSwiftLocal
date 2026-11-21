'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Car,
  Droplets,
  Home,
  Loader2,
  Lock,
  MapPin,
  ParkingCircle,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import {
  formatIndianPropertyPrice,
  getFreshnessState,
} from '@/lib/real-estate/helpers';
import type { ListingRealEstateProfile } from '@/lib/real-estate/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface RealEstateSummaryModalProps {
  listing: Listing;
  onClose: () => void;
  onOpenFullDetailPage: (listingId: string) => void;
}

const PATTA_LABELS: Record<string, string> = {
  verified_patta: 'Clear Patta',
  village_authority: 'Village Authority',
  leasehold: 'Leasehold',
  not_applicable: 'N/A',
};

const WATER_LABELS: Record<string, string> = {
  '24x7': '24×7 Water',
  municipal: 'Municipal Supply',
  borewell: 'Borewell',
  tanker: 'Tanker Supply',
  seasonal: 'Seasonal',
};

const ROAD_LABELS: Record<string, string> = {
  car_accessible: 'Car Accessible Road',
  two_wheeler_only: 'Two-Wheeler Lane',
  footpath: 'Footpath Access',
};

export function RealEstateSummaryModal({
  listing,
  onClose,
  onOpenFullDetailPage,
}: RealEstateSummaryModalProps) {
  const [profile, setProfile] = useState<ListingRealEstateProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function fetchProfile() {
      if (!isSupabaseConfigured()) {
        if (active) setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const { data } = await supabase
          .from('listing_real_estate_profiles')
          .select('*')
          .eq('listing_id', listing.id)
          .maybeSingle();
        if (active && data) {
          setProfile(data as ListingRealEstateProfile);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void fetchProfile();
    return () => {
      active = false;
    };
  }, [listing.id]);

  if (typeof document === 'undefined') return null;

  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
  const dealType = profile?.deal_type || String(summary.deal_type || 'rent');
  const priceInr = Number(profile?.price_inr ?? summary.price_inr ?? 0);
  const pricePeriod = (profile?.price_period ||
    summary.price_period ||
    (dealType === 'sale' ? 'total' : 'monthly')) as 'total' | 'monthly' | 'yearly';

  const pattaStatus = profile?.patta_status || String(summary.patta_status || 'not_applicable');
  const pattaVerified = Boolean(profile?.patta_verified ?? summary.patta_verified);
  const siteVerified = Boolean(profile?.site_verified ?? summary.site_verified);
  const waterSupply = profile?.water_supply || String(summary.water_supply || 'municipal');
  const roadAccess = profile?.road_access || String(summary.road_access || 'car_accessible');
  const listedByRole = profile?.listed_by_role || String(summary.listed_by_role || 'owner');
  const showExactPin = profile ? Boolean(profile.show_exact_pin) : false;

  const boostExp =
    profile?.verified_boost_expires_at ||
    (typeof summary.verified_boost_expires_at === 'string'
      ? summary.verified_boost_expires_at
      : null);
  const isBoosted = Boolean(
    boostExp && !Number.isNaN(Date.parse(boostExp)) && Date.parse(boostExp) > Date.now()
  );

  const freshnessState = getFreshnessState(
    profile?.freshness_expires_at ||
      (typeof summary.freshness_expires_at === 'string'
        ? summary.freshness_expires_at
        : null)
  );

  const photos = [
    ...(listing.coverImage ? [listing.coverImage] : []),
    ...(Array.isArray(listing.galleryImages) ? listing.galleryImages : []),
  ]
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .slice(0, 4);

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={listing.title}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
      >
        {/* Photo Strip */}
        <div className="relative bg-slate-900">
          {photos.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {photos.map((src, idx) => (
                <div
                  key={`${src}-${idx}`}
                  className={`relative h-44 shrink-0 ${
                    photos.length === 1 ? 'w-full' : 'w-4/5'
                  }`}
                >
                  <Image
                    loader={supabaseMediaImageLoader}
                    src={src}
                    alt={`${listing.title} photo ${idx + 1}`}
                    fill
                    sizes="480px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-36 items-center justify-center bg-violet-500/10 text-violet-600">
              <Home className="h-10 w-10" />
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary modal"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/70 text-white hover:bg-slate-950 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs">
              {dealType.replace('_', ' ')}
            </span>
            {isBoosted && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs">
                <Sparkles className="h-3 w-3" />
                FEATURED
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xl font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">
                  {formatIndianPropertyPrice(priceInr, pricePeriod)}
                </span>
                {profile?.is_negotiable && (
                  <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    Negotiable
                  </span>
                )}
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold capitalize text-[var(--ps-text)]">
                <UserCheck className="h-3 w-3 text-violet-500" />
                {listedByRole === 'agent'
                  ? 'Verified Agent'
                  : listedByRole === 'builder'
                    ? 'Builder'
                    : 'Direct Owner'}
              </span>
            </div>

            {profile?.deposit_inr && Number(profile.deposit_inr) > 0 && (
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Security Deposit:{' '}
                <strong className="font-mono text-[var(--ps-text)]">
                  ₹{Number(profile.deposit_inr).toLocaleString('en-IN')}
                </strong>
              </p>
            )}

            <h2 className="text-base font-bold text-[var(--ps-text)]">
              {listing.title.replace(/^\[SAMPLE\]\s*/i, '')}
            </h2>
            <p className="flex items-center gap-1 text-xs text-[var(--ps-text-muted)]">
              <MapPin className="h-3.5 w-3.5 text-violet-500 shrink-0" />
              <span>{listing.locality}</span>
              {freshnessState === 'stale' && (
                <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  Confirm Availability
                </span>
              )}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
              <span>Loading verified property specs…</span>
            </div>
          ) : (
            <>
              {/* Regional Trust Badges */}
              <div className="flex flex-wrap gap-1.5">
                {pattaStatus !== 'not_applicable' && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold ${
                      pattaVerified
                        ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                    }`}
                  >
                    <BadgeCheck className="h-3.5 w-3.5" />
                    <span>
                      {PATTA_LABELS[pattaStatus] || pattaStatus}
                      {pattaVerified ? ' ✓' : ''}
                    </span>
                  </span>
                )}
                {siteVerified && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-violet-500/35 bg-violet-500/12 px-2 py-1 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Site Verified ✓</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                  <Droplets className="h-3.5 w-3.5" />
                  <span>{WATER_LABELS[waterSupply] || waterSupply}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--ps-text)]">
                  <Car className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                  <span>{ROAD_LABELS[roadAccess] || roadAccess}</span>
                </span>
                {profile?.power_backup && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--ps-text)]">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <span>Power Backup</span>
                  </span>
                )}
                {profile?.parking_available && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--ps-text)]">
                    <ParkingCircle className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Parking</span>
                  </span>
                )}
              </div>

              {/* Approximate Location Privacy Notice */}
              {!showExactPin && (
                <div className="flex items-start gap-2 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2 text-[11px] text-violet-900 dark:text-violet-200">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                  <span>
                    Map pin shows an approximate neighborhood location (~180m) for owner privacy. Exact doorstep &amp; contact unlock when your site visit is accepted.
                  </span>
                </div>
              )}
            </>
          )}

          {/* Primary CTA */}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--ps-border)] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-[var(--ps-border)] px-3.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              Close
            </button>
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}`}
              onClick={() => onOpenFullDetailPage(listing.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-violet-700"
            >
              <span>Full Specs &amp; Schedule Visit</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
