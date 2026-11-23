import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { PrintOrderClient } from '@/components/print-orders/PrintOrderClient';
import { isUuid } from '@/lib/payments/types';
import { createServerSupabaseReadClient } from '@/lib/pick-n-drop/fare';
import { normalizeListingPrintProfile } from '@/lib/print-orders/server-helpers';
import type { ListingPrintProfile } from '@/lib/print-orders/types';
import { splitSamplePrefix } from '@/lib/utils/display-title';

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

  let decodedId = '';
  try {
    decodedId = decodeURIComponent(listingId || '').trim();
  } catch {
    decodedId = String(listingId || '').trim();
  }

  if (!isUuid(decodedId)) {
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
      .select(
        'id, title, locality, address, hub_id, phone, contact_phone, lat, lng, coordinates, owner_id, status, lifecycle_status, listing_vertical, vertical_summary, business_details, service_details, metadata'
      )
      .eq('id', decodedId)
      .maybeSingle(),
    supabase
      .from('listing_print_profiles')
      .select('*')
      .eq('listing_id', decodedId)
      .maybeSingle(),
    supabase.rpc('has_active_print_entitlement', {
      p_listing_id: decodedId,
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
  const listingStatus = String(rawListing.status || 'published').toLowerCase();
  const lifecycleStatus = String(
    rawListing.lifecycle_status || 'active'
  ).toLowerCase();

  if (
    listingStatus !== 'published' ||
    (lifecycleStatus !== 'active' && lifecycleStatus !== 'draining')
  ) {
    return {
      listing: null,
      profile: null,
      hasActiveEntitlement: false,
      isPrintModuleEnabled: true,
      hubPauseMessage: null,
    };
  }

  const profile =
    !profileRes.error && profileRes.data
      ? normalizeListingPrintProfile(profileRes.data as Record<string, unknown>)
      : null;

  const summary =
    rawListing.vertical_summary &&
    typeof rawListing.vertical_summary === 'object' &&
    !Array.isArray(rawListing.vertical_summary)
      ? (rawListing.vertical_summary as Record<string, unknown>)
      : {};

  const isOfficialPrintSwift = Boolean(
    profile?.is_official_printswift ||
      profile?.is_first_party_printswift ||
      summary.is_official_printswift === true ||
      summary.is_first_party_printswift === true
  );

  const vertical = String(rawListing.listing_vertical || 'general').toLowerCase();
  const rawTitleStr = String(rawListing.title || '');
  const isPrintEligibleListing =
    vertical === 'print_digital' ||
    isOfficialPrintSwift ||
    Boolean(profile) ||
    /printswift/i.test(rawTitleStr);

  if (!isPrintEligibleListing) {
    return {
      listing: null,
      profile: null,
      hasActiveEntitlement: false,
      isPrintModuleEnabled: true,
      hubPauseMessage: null,
    };
  }

  const coordsObj =
    rawListing.coordinates &&
    typeof rawListing.coordinates === 'object' &&
    !Array.isArray(rawListing.coordinates)
      ? (rawListing.coordinates as Record<string, unknown>)
      : {};
  const metaObj =
    rawListing.metadata &&
    typeof rawListing.metadata === 'object' &&
    !Array.isArray(rawListing.metadata)
      ? (rawListing.metadata as Record<string, unknown>)
      : {};
  const bizObj =
    rawListing.business_details &&
    typeof rawListing.business_details === 'object' &&
    !Array.isArray(rawListing.business_details)
      ? (rawListing.business_details as Record<string, unknown>)
      : {};

  const resolvedLat =
    rawListing.lat !== null &&
    rawListing.lat !== undefined &&
    Number.isFinite(Number(rawListing.lat))
      ? Number(rawListing.lat)
      : Number.isFinite(Number(coordsObj.lat))
        ? Number(coordsObj.lat)
        : null;
  const resolvedLng =
    rawListing.lng !== null &&
    rawListing.lng !== undefined &&
    Number.isFinite(Number(rawListing.lng))
      ? Number(rawListing.lng)
      : Number.isFinite(Number(coordsObj.lng))
        ? Number(coordsObj.lng)
        : null;

  const resolvedPhone = rawListing.phone
    ? String(rawListing.phone)
    : rawListing.contact_phone
      ? String(rawListing.contact_phone)
      : null;
  const resolvedWhatsapp =
    (typeof metaObj.whatsapp === 'string' && metaObj.whatsapp.trim()
      ? metaObj.whatsapp.trim()
      : null) ||
    (typeof bizObj.whatsapp_number === 'string' && bizObj.whatsapp_number.trim()
      ? bizObj.whatsapp_number.trim()
      : null) ||
    resolvedPhone;

  const listing: PrintShopListingSummary = {
    id: String(rawListing.id),
    title: splitSamplePrefix(String(rawListing.title || 'Print Shop')).title,
    locality: String(rawListing.locality || ''),
    address: rawListing.address ? String(rawListing.address) : null,
    hub_id: rawListing.hub_id ? String(rawListing.hub_id) : null,
    phone: resolvedPhone,
    whatsapp: resolvedWhatsapp,
    lat: resolvedLat,
    lng: resolvedLng,
  };

  let hasActiveEntitlement = Boolean(
    isOfficialPrintSwift || entitlementRes.data === true
  );

  if (!hasActiveEntitlement && rawListing.owner_id) {
    try {
      const { data: eff } = await supabase.rpc('get_effective_entitlements', {
        p_user_id: String(rawListing.owner_id),
        p_listing_id: decodedId,
      });
      if (eff && typeof eff === 'object') {
        const effObj = eff as {
          is_super_admin_bypass?: boolean;
          features?: Record<string, boolean>;
        };
        if (
          effObj.is_super_admin_bypass ||
          effObj.features?.print_online_orders === true
        ) {
          hasActiveEntitlement = true;
        }
      }
    } catch {
      // keep existing entitlement value
    }
  }

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
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 text-xs font-bold text-[var(--btn-primary-fg)] shadow-sm hover:opacity-95 transition-opacity"
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
