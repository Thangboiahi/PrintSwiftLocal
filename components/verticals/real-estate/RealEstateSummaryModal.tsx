'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Car,
  Droplets,
  Lock,
  ParkingCircle,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Zap,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import {
  formatIndianPropertyPrice,
  getFreshnessState,
} from '@/lib/real-estate/helpers';
import type { ListingRealEstateProfile } from '@/lib/real-estate/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
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

  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
  const dealType = profile?.deal_type || String(summary.deal_type || 'rent');
  const priceInr = Number(profile?.price_inr ?? summary.price_inr ?? 0);
  const pricePeriod = (profile?.price_period ||
    summary.price_period ||
    (dealType === 'sale' ? 'total' : 'monthly')) as
    | 'total'
    | 'monthly'
    | 'yearly';

  const formattedPrice =
    priceInr > 0 ? formatIndianPropertyPrice(priceInr, pricePeriod) : null;

  const pattaStatus =
    profile?.patta_status || String(summary.patta_status || 'not_applicable');
  const pattaVerified = Boolean(
    profile?.patta_verified ?? summary.patta_verified
  );
  const siteVerified = Boolean(profile?.site_verified ?? summary.site_verified);
  const waterSupply =
    profile?.water_supply || String(summary.water_supply || 'municipal');
  const roadAccess =
    profile?.road_access || String(summary.road_access || 'car_accessible');
  const listedByRole =
    profile?.listed_by_role || String(summary.listed_by_role || 'owner');
  const showExactPin = profile ? Boolean(profile.show_exact_pin) : false;

  const boostExp =
    profile?.verified_boost_expires_at ||
    (typeof summary.verified_boost_expires_at === 'string'
      ? summary.verified_boost_expires_at
      : null);
  const isBoosted = Boolean(
    boostExp &&
      !Number.isNaN(Date.parse(boostExp)) &&
      Date.parse(boostExp) > Date.now()
  );

  const freshnessState = getFreshnessState(
    profile?.freshness_expires_at ||
      (typeof summary.freshness_expires_at === 'string'
        ? summary.freshness_expires_at
        : null)
  );

  const dealLabel = dealType.replace('_', ' ');

  return (
    <ListingSummarySheetShell
      listing={listing}
      onClose={onClose}
      testId="real-estate-summary-modal"
      ariaLabel={`Property summary for ${listing.title}`}
      categoryLabel={`Property · ${dealLabel}`}
      shareVerticalBadge="Real Estate"
      sharePriceLabel={formattedPrice}
      isVerifiedOverride={Boolean(
        siteVerified ||
          pattaVerified ||
          listing.is_verified ||
          listing.verificationStatus === 'verified_demo'
      )}
      verticalBadgeSlot={
        <>
          <span className="rounded-md bg-violet-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
            {dealLabel}
          </span>
          {isBoosted && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs">
              <Sparkles className="h-3 w-3" />
              Featured
            </span>
          )}
        </>
      }
      priceHighlight={
        formattedPrice ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-lg font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">
              {formattedPrice}
            </span>
            {profile?.is_negotiable && (
              <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                Negotiable
              </span>
            )}
          </div>
        ) : null
      }
      identityExtraSlot={
        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 font-bold text-[var(--ps-text)]">
            <UserCheck className="h-3 w-3 text-violet-500" />
            {listedByRole === 'agent'
              ? 'Verified Agent'
              : listedByRole === 'builder'
                ? 'Builder'
                : 'Direct Owner'}
          </span>
          {profile?.deposit_inr && Number(profile.deposit_inr) > 0 && (
            <span className="text-[var(--ps-text-muted)]">
              Deposit:{' '}
              <strong className="font-mono text-[var(--ps-text)]">
                ₹{Number(profile.deposit_inr).toLocaleString('en-IN')}
              </strong>
            </span>
          )}
          {freshnessState === 'stale' && (
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              Confirm Availability
            </span>
          )}
        </div>
      }
      footerSlot={
        <div className="flex items-center gap-2">
          <Link
            href={`/listing/${encodeURIComponent(listing.id)}#request-visit`}
            onClick={() => onOpenFullDetailPage(listing.id)}
            data-testid="real-estate-summary-primary-cta"
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-violet-700"
          >
            <span>Request Visit</span>
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
      {isLoading ? (
        <div
          className="space-y-2.5"
          data-testid="real-estate-summary-skeleton"
        >
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="dd-shimmer h-7 w-24 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]"
              />
            ))}
          </div>
          <div className="dd-shimmer h-40 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Regional Trust & Utility Specs */}
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

          {/* Interactive Location & Guaranteed Polygon Mini-Map */}
          <DynamicListingLocationMap
            listingId={listing.id}
            title={listing.title}
            locality={listing.locality}
            address={listing.address}
            coordinates={listing.coordinates}
            listingVertical="real_estate"
            boundaryPolygon={listing.realEstateDetails?.boundaryPolygon}
            boundaryGeoJson={
              profile?.boundary_geojson ?? summary.boundary_geojson
            }
            secondaryBoundaryGeoJson={listing.boundary_geojson}
            areaSqft={
              profile?.area_sqft ??
              (summary.area_sqft ? Number(summary.area_sqft) : null)
            }
            landAreaText={
              profile?.land_area_text ??
              (typeof summary.land_area_text === 'string'
                ? summary.land_area_text
                : null)
            }
            pattaStatus={pattaStatus}
            pattaVerified={pattaVerified}
            showExactPin={showExactPin}
            compact
          />

          {/* Approximate Location Privacy Notice */}
          {!showExactPin && (
            <div className="flex items-start gap-2 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2 text-[11px] text-violet-900 dark:text-violet-200">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
              <span>
                Approximate neighborhood pin (~180m) shown for owner privacy.
                Exact doorstep &amp; contact unlock once your site visit is
                accepted.
              </span>
            </div>
          )}
        </div>
      )}
    </ListingSummarySheetShell>
  );
}
