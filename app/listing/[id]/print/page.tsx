import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { PrintOrderClient } from '@/components/print-orders/PrintOrderClient';
import { createServerSupabaseReadClient } from '@/lib/pick-n-drop/fare';
import { normalizeListingPrintProfile } from '@/lib/print-orders/server-helpers';
import type { ListingPrintProfile } from '@/lib/print-orders/types';

interface ListingPrintPageProps {
  params: Promise<{ id: string }>;
}

interface PrintShopListingSummary {
  id: string;
  title: string;
  locality: string;
  address: string | null;
  hub_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
}

async function fetchPrintPageServerData(listingId: string): Promise<{
  listing: PrintShopListingSummary | null;
  profile: ListingPrintProfile | null;
  hasActiveEntitlement: boolean;
  isPrintModuleEnabled: boolean;
  hubPauseMessage: string | null;
}> {
  const supabase = createServerSupabaseReadClient();
  if (!supabase) {
    return {
      listing: null,
      profile: null,
      hasActiveEntitlement: false,
      isPrintModuleEnabled: true,
      hubPauseMessage: null,
    };
  }

  const [listingRes, profileRes, entitlementRes] = await Promise.all([
    supabase
      .from('listings')
      .select('id, title, locality, address, hub_id, phone, whatsapp, lat, lng')
      .eq('id', listingId)
      .maybeSingle(),
    supabase
      .from('listing_print_profiles')
      .select('*')
      .eq('listing_id', listingId)
      .maybeSingle(),
    supabase.rpc('has_active_print_entitlement', {
      p_listing_id: listingId,
    }),
  ]);

  if (listingRes.error || !listingRes.data) {
    return {
      listing: null,
      profile: null,
      hasActiveEntitlement: false,
      isPrintModuleEnabled: true,
      hubPauseMessage: null,
    };
  }

  const rawListing = listingRes.data as Record<string, unknown>;
  const listing: PrintShopListingSummary = {
    id: String(rawListing.id),
    title: String(rawListing.title || 'Print Shop').replace(/^\[SAMPLE\]\s*/i, ''),
    locality: String(rawListing.locality || ''),
    address: rawListing.address ? String(rawListing.address) : null,
    hub_id: rawListing.hub_id ? String(rawListing.hub_id) : null,
    phone: rawListing.phone ? String(rawListing.phone) : null,
    whatsapp: rawListing.whatsapp ? String(rawListing.whatsapp) : null,
    lat:
      rawListing.lat !== null &&
      rawListing.lat !== undefined &&
      Number.isFinite(Number(rawListing.lat))
        ? Number(rawListing.lat)
        : null,
    lng:
      rawListing.lng !== null &&
      rawListing.lng !== undefined &&
      Number.isFinite(Number(rawListing.lng))
        ? Number(rawListing.lng)
        : null,
  };

  const profile =
    !profileRes.error && profileRes.data
      ? normalizeListingPrintProfile(profileRes.data as Record<string, unknown>)
      : null;

  const hasActiveEntitlement = entitlementRes.data === true;

  let isPrintModuleEnabled = true;
  let hubPauseMessage: string | null = null;
  const targetHubId = profile?.hub_id || listing.hub_id;

  if (targetHubId) {
    const { data: hubRow } = await supabase
      .from('service_hubs')
      .select('name, status, module_switches')
      .eq('id', targetHubId)
      .maybeSingle();

    if (hubRow) {
      if (String(hubRow.status || 'active') === 'paused') {
        isPrintModuleEnabled = false;
        hubPauseMessage = `Online print ordering is currently paused in ${hubRow.name || 'this hub'}.`;
      } else if (
        hubRow.module_switches &&
        typeof hubRow.module_switches === 'object' &&
        !Array.isArray(hubRow.module_switches)
      ) {
        const sw = (hubRow.module_switches as Record<string, unknown>)
          .print_orders;
        if (sw === false) {
          isPrintModuleEnabled = false;
          hubPauseMessage = `Print & Digital ordering is currently paused in ${hubRow.name || 'this hub'}.`;
        } else if (
          sw &&
          typeof sw === 'object' &&
          !Array.isArray(sw) &&
          (sw as Record<string, unknown>).enabled === false
        ) {
          isPrintModuleEnabled = false;
          const customMsg = String(
            (sw as Record<string, unknown>).pause_message || ''
          ).trim();
          hubPauseMessage =
            customMsg ||
            `Print & Digital ordering is currently paused in ${hubRow.name || 'this hub'}.`;
        }
      }
    }
  }

  return {
    listing,
    profile,
    hasActiveEntitlement,
    isPrintModuleEnabled,
    hubPauseMessage,
  };
}

export async function generateMetadata({
  params,
}: ListingPrintPageProps): Promise<Metadata> {
  const { id } = await params;
  const { listing } = await fetchPrintPageServerData(id);

  if (!listing) {
    return {
      title: 'Print Shop Not Found | DD oodle',
      description: 'The requested print & digital service shop could not be found.',
    };
  }

  return {
    title: `Print & Digital Order · ${listing.title} | DD oodle`,
    description: `Upload documents, configure printing options, or request a custom digital job from ${listing.title}${listing.locality ? ` in ${listing.locality}` : ''}.`,
  };
}

export default async function ListingPrintOrderPage({
  params,
}: ListingPrintPageProps) {
  const { id } = await params;
  const {
    listing,
    profile,
    hasActiveEntitlement,
    isPrintModuleEnabled,
    hubPauseMessage,
  } = await fetchPrintPageServerData(id);

  if (!listing) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)]">
            <Printer className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-bold text-[var(--ps-text)]">
            Print Shop Not Found
          </h1>
          <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
            This listing could not be found or is no longer available for online print orders.
          </p>
          <div className="pt-2">
            <Link
              href="/explore"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Explore</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PrintOrderClient
      listing={listing}
      profile={profile}
      hasActiveEntitlement={hasActiveEntitlement}
      isPrintModuleEnabled={isPrintModuleEnabled}
      hubPauseMessage={hubPauseMessage}
    />
  );
}
