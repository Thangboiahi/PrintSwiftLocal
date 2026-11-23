import React from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Bath,
  BedDouble,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  Globe,
  Home,
  Image as ImageIcon,
  IndianRupee,
  Landmark,
  Layers,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  PhoneCall,
  Radar,
  ShieldCheck,
  Tag,
  Trophy,
  Truck,
  Wrench,
} from 'lucide-react';
import { EnquiryForm } from '@/components/discovery/EnquiryForm';
import { ReviewSection } from '@/components/discovery/ReviewSection';
import { CrossHubBanner } from '@/components/hub/CrossHubBanner';
import { PageSubNavPill } from '@/components/navigation/PageSubNavPill';
import {
  PrintServiceCard,
  type ListingProvenanceTier,
} from '@/components/listing/PrintServiceCard';
import { BookingServiceCard } from '@/components/verticals/bookings/BookingServiceCard';
import { Panorama360Viewer, type PublicPanorama360Scene } from '@/components/verticals/Panorama360Viewer';
import { RichTextDisplay } from '@/components/ui/RichTextEditor';
import { HotelServiceCard } from '@/components/verticals/hotels/HotelServiceCard';
import { RealEstateDetailClient } from '@/components/verticals/real-estate/RealEstateDetailClient';
import { RestaurantMenuClient } from '@/components/verticals/restaurants/RestaurantMenuClient';
import {
  ShopStorefrontClient,
  type StorefrontProductItem,
} from '@/components/verticals/shops/ShopStorefrontClient';
import { getServerSessionContext } from '@/lib/auth-server';
import type {
  ListingRealEstateProfile,
  PropertyVisitRequest,
} from '@/lib/real-estate/types';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import {
  normalizeBookingResourceRow,
  normalizeHotelProfileRow,
} from '@/lib/bookings/server-helpers';
import type {
  ListingBookingResource,
  ListingHotelProfile,
} from '@/lib/bookings/types';
import {
  normalizeMenuItemRow,
  normalizeRestaurantProfileRow,
  normalizeShopProfileRow,
} from '@/lib/commerce/server-helpers';
import type {
  ListingRestaurantProfile,
  ListingShopProfile,
  RestaurantMenuItem,
} from '@/lib/commerce/types';
import { createServerSupabaseReadClient } from '@/lib/pick-n-drop/fare';
import {
  isListingInPrintingDigitalDomain,
  normalizeClientPrintProfile,
} from '@/lib/print-orders/client-helpers';
import type { ListingPrintProfile } from '@/lib/print-orders/types';
import { CATEGORY_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/rules';
import { fetchListingById } from '@/lib/supabase/listings';
import type { PropertyType } from '@/lib/types';

interface ListingDetailPageProps {
  params: Promise<{ id: string }>;
}

const LISTING_TYPE_DISPLAY_LABELS: Record<string, string> = {
  business: 'Businesses & Shops',
  service: 'Services',
  real_estate: 'Real Estate',
  public_interest: 'Public & Community Places',
  public_place: 'Public & Community Places',
  sports: 'Sports & Recreation',
};

function formatOpeningHours(
  rawOpeningHours: unknown,
  fallbackString?: string | null
): string {
  if (typeof rawOpeningHours === 'string' && rawOpeningHours.trim()) {
    return rawOpeningHours.trim();
  }
  if (
    rawOpeningHours &&
    typeof rawOpeningHours === 'object' &&
    !Array.isArray(rawOpeningHours)
  ) {
    const entries = Object.entries(rawOpeningHours as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== '')
      .map(([day, hours]) => `${day}: ${String(hours)}`);
    if (entries.length > 0) {
      return entries.join(' • ');
    }
  }
  if (fallbackString && fallbackString.trim()) {
    return fallbackString.trim();
  }
  return 'Mon – Sat: 9:00 AM – 7:00 PM';
}

function buildPolygonSvgData(points: Array<{ lat: number; lng: number }>) {
  if (points.length < 3) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latSpan = Math.max(maxLat - minLat, 0.0004);
  const lngSpan = Math.max(maxLng - minLng, 0.0004);
  const pad = 28;
  const width = 480;
  const height = 260;

  const projected = points.map((pt) => {
    const x =
      pad + ((pt.lng - minLng) / lngSpan) * (width - pad * 2);
    const y =
      height - pad - ((pt.lat - minLat) / latSpan) * (height - pad * 2);
    return {
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      lat: pt.lat,
      lng: pt.lng,
    };
  });

  const centerLat = Number(
    (points.reduce((acc, p) => acc + p.lat, 0) / points.length).toFixed(5)
  );
  const centerLng = Number(
    (points.reduce((acc, p) => acc + p.lng, 0) / points.length).toFixed(5)
  );

  return {
    width,
    height,
    projected,
    svgPointsString: projected.map((p) => `${p.x},${p.y}`).join(' '),
    centerLat,
    centerLng,
  };
}

export async function generateMetadata({
  params,
}: ListingDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await fetchListingById(id);

  if (!listing) {
    return {
      title: 'Listing Not Found | DD oodle',
      description:
        'The requested Churachandpur directory listing could not be found or is not currently published.',
    };
  }

  const categoryName =
    listing.categoryDetails?.name ||
    LISTING_TYPE_DISPLAY_LABELS[listing.listing_type] ||
    CATEGORY_LABELS[listing.category] ||
    'Directory Listing';

  const summary =
    listing.shortDescription ||
    listing.description ||
    `Explore ${listing.title} (${categoryName}) in ${listing.locality}, Churachandpur on DD oodle.`;

  const mediaRecords = Array.isArray(listing.listingMedia)
    ? listing.listingMedia.filter((m) => Boolean(m?.url?.trim()))
    : [];
  const primaryStandardMedia =
    mediaRecords.find(
      (m) =>
        Boolean(m.is_primary) &&
        m.media_type !== 'panorama_360' &&
        m.is_equirectangular !== true
    ) ||
    mediaRecords.find(
      (m) => m.media_type !== 'panorama_360' && m.is_equirectangular !== true
    ) ||
    mediaRecords[0] ||
    null;

  const primaryImageUrl =
    primaryStandardMedia?.url?.trim() ||
    listing.coverImage?.trim() ||
    listing.galleryImages?.find((img) => Boolean(img?.trim()))?.trim() ||
    '';
  const primaryImageAlt =
    primaryStandardMedia?.caption ||
    primaryStandardMedia?.name ||
    `${listing.title} — ${categoryName} in ${listing.locality}`;

  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://ddoodle.in'
  ).replace(/\/+$/, '');
  const canonicalUrl = `${baseUrl}/listing/${encodeURIComponent(listing.id)}`;

  return {
    title: `${listing.title} — ${categoryName} | DD oodle`,
    description: summary,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${listing.title} | DD oodle`,
      description: summary,
      url: canonicalUrl,
      siteName: 'DD oodle',
      locale: 'en_IN',
      type: 'website',
      ...(primaryImageUrl
        ? {
            images: [
              {
                url: primaryImageUrl,
                width: 1200,
                height: 630,
                alt: primaryImageAlt,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${listing.title} | DD oodle`,
      description: summary,
      ...(primaryImageUrl ? { images: [primaryImageUrl] } : {}),
    },
  };
}

export default async function ListingDetailPage({
  params,
}: ListingDetailPageProps) {
  const { id } = await params;
  const listing = await fetchListingById(id);

  if (!listing) {
    return (
      <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <Breadcrumbs items={[{ label: 'Listing Not Found' }]} />
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-4 shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
              <Building2 className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Listing Not Found
            </h1>
            <p className="mx-auto max-w-md text-xs text-[var(--ps-text-muted)]">
              We could not locate a listing with ID{' '}
              <code className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 font-mono">
                {id}
              </code>{' '}
              in the live Supabase database.
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Discovery Map</span>
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  // Pass R3: Public & Civic records terminate in CivicSummaryModal on /explore
  if (listing.listing_vertical === 'public_civic' || listing.is_civic_record) {
    redirect(`/explore?civic=${encodeURIComponent(id)}`);
  }

  // Pass R3: Determine if signed-in viewer is Owner or delegated Staff (for read-only Workspace pill)
  let manageWorkspaceHat: 'owner' | 'staff' | null = null;
  try {
    const viewerSession = await getServerSessionContext();
    const viewerId = viewerSession.profile?.id
      ? String(viewerSession.profile.id)
      : null;
    if (viewerId) {
      if (listing.ownerId && listing.ownerId === viewerId) {
        manageWorkspaceHat = 'owner';
      } else if (
        Array.isArray(listing.assignedStaffIds) &&
        listing.assignedStaffIds.includes(viewerId)
      ) {
        manageWorkspaceHat = 'staff';
      }
    }
  } catch {
    // Non-blocking
  }

  // Phase 71-D: Fetch listing_print_profiles + active entitlement for 3-tier PrintServiceCard
  // Phase 73-C: Fetch booking resources & hotel profile for BookingServiceCard / HotelServiceCard
  // Phase 74-C: Fetch shop/restaurant profiles, catalogue/menu items, entitlement & hub module switches
  let printProfile: ListingPrintProfile | null = null;
  let hasActivePrintEntitlement = false;
  let isPrintModuleEnabled = true;
  let bookingResources: ListingBookingResource[] = [];
  let hotelProfile: ListingHotelProfile | null = null;
  let hasActiveBookingEntitlement = false;
  let shopProfile: ListingShopProfile | null = null;
  let shopProducts: StorefrontProductItem[] = [];
  let hasActiveShopEntitlement = false;
  let isShopModuleEnabled = true;
  let restaurantProfile: ListingRestaurantProfile | null = null;
  let restaurantMenuItems: RestaurantMenuItem[] = [];
  let hasActiveRestaurantEntitlement = false;
  let isFoodModuleEnabled = true;
  let realEstateProfile: ListingRealEstateProfile | null = null;
  let existingVisitRequest: PropertyVisitRequest | null = null;
  let isRealEstateModuleEnabled = true;

  const isBookingVenueVertical = listing.listing_vertical === 'booking_venue';
  const isHotelStayVertical = listing.listing_vertical === 'hotel_stay';
  const isShopCatalogueVertical = listing.listing_vertical === 'shop_catalogue';
  const isRestaurantFoodVertical = listing.listing_vertical === 'restaurant_food';
  const isRealEstateVertical =
    listing.listing_vertical === 'real_estate' ||
    listing.category === 'real_estate';

  try {
    const supabaseRead = createServerSupabaseReadClient();
    if (supabaseRead) {
      const [
        profileRes,
        entitlementRes,
        moduleRes,
        bookingResourcesRes,
        hotelProfileRes,
        bookingEntitlementRes,
        shopProfileRes,
        shopProductsRes,
        shopEntitlementRes,
        restaurantProfileRes,
        restaurantMenuRes,
        restaurantEntitlementRes,
        realEstateProfileRes,
        hubSwitchesRes,
      ] = await Promise.all([
        supabaseRead
          .from('listing_print_profiles')
          .select('*')
          .eq('listing_id', listing.id)
          .maybeSingle(),
        supabaseRead.rpc('has_active_print_entitlement', {
          p_listing_id: listing.id,
        }),
        supabaseRead
          .from('app_config')
          .select('config_value')
          .eq('config_key', 'print_orders_settings')
          .maybeSingle(),
        isBookingVenueVertical || isHotelStayVertical
          ? supabaseRead
              .from('listing_booking_resources')
              .select('*')
              .eq('listing_id', listing.id)
              .eq('is_active', true)
              .order('sort_order', { ascending: true })
              .order('base_rate_inr', { ascending: true })
          : Promise.resolve({ data: null }),
        isHotelStayVertical
          ? supabaseRead
              .from('listing_hotel_profiles')
              .select('*')
              .eq('listing_id', listing.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        isBookingVenueVertical || isHotelStayVertical
          ? supabaseRead.rpc('has_active_booking_entitlement', {
              p_listing_id: listing.id,
              p_vertical: isHotelStayVertical ? 'hotel_stay' : 'booking_venue',
            })
          : Promise.resolve({ data: false }),
        isShopCatalogueVertical
          ? supabaseRead
              .from('listing_shop_profiles')
              .select('*')
              .eq('listing_id', listing.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        isShopCatalogueVertical
          ? supabaseRead
              .from('marketplace_products')
              .select(
                'id, title, description, price, unit, unit_label, shop_category_tag, in_stock, sort_order'
              )
              .eq('listing_id', listing.id)
              .eq('is_active', true)
              .order('sort_order', { ascending: true })
              .order('title', { ascending: true })
          : Promise.resolve({ data: null }),
        isShopCatalogueVertical
          ? supabaseRead.rpc('has_active_commerce_entitlement', {
              p_listing_id: listing.id,
              p_vertical: 'shop_catalogue',
            })
          : Promise.resolve({ data: false }),
        isRestaurantFoodVertical
          ? supabaseRead
              .from('listing_restaurant_profiles')
              .select('*')
              .eq('listing_id', listing.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        isRestaurantFoodVertical
          ? supabaseRead
              .from('restaurant_menu_items')
              .select('*')
              .eq('listing_id', listing.id)
              .order('sort_order', { ascending: true })
              .order('name', { ascending: true })
          : Promise.resolve({ data: null }),
        isRestaurantFoodVertical
          ? supabaseRead.rpc('has_active_commerce_entitlement', {
              p_listing_id: listing.id,
              p_vertical: 'restaurant_food',
            })
          : Promise.resolve({ data: false }),
        isRealEstateVertical
          ? supabaseRead
              .from('listing_real_estate_profiles')
              .select('*')
              .eq('listing_id', listing.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        (isShopCatalogueVertical ||
          isRestaurantFoodVertical ||
          isRealEstateVertical) &&
        listing.hub_id
          ? supabaseRead
              .from('service_hubs')
              .select('module_switches')
              .eq('id', listing.hub_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (profileRes.data) {
        printProfile = normalizeClientPrintProfile(
          profileRes.data as Record<string, unknown>
        );
      }

      if (typeof entitlementRes.data === 'boolean') {
        hasActivePrintEntitlement = entitlementRes.data;
      } else if (printProfile?.is_first_party_printswift) {
        hasActivePrintEntitlement = true;
      }

      const modVal = moduleRes.data?.config_value as
        | Record<string, unknown>
        | undefined;
      if (modVal && modVal.enabled === false) {
        isPrintModuleEnabled = false;
      }

      if (Array.isArray(bookingResourcesRes.data)) {
        bookingResources = bookingResourcesRes.data.map((row) =>
          normalizeBookingResourceRow(row as Record<string, unknown>)
        );
      }
      if (hotelProfileRes.data) {
        hotelProfile = normalizeHotelProfileRow(
          hotelProfileRes.data as Record<string, unknown>
        );
      }
      hasActiveBookingEntitlement = bookingEntitlementRes.data === true;

      if (shopProfileRes.data) {
        shopProfile = normalizeShopProfileRow(
          shopProfileRes.data as Record<string, unknown>
        );
      }
      if (Array.isArray(shopProductsRes.data)) {
        shopProducts = (shopProductsRes.data as Array<Record<string, unknown>>).map(
          (row) => ({
            id: String(row.id),
            title: String(row.title ?? 'Item'),
            description:
              typeof row.description === 'string' ? row.description : null,
            price: Number(row.price ?? 0),
            unit: typeof row.unit === 'string' ? row.unit : null,
            unit_label:
              typeof row.unit_label === 'string' ? row.unit_label : null,
            shop_category_tag:
              typeof row.shop_category_tag === 'string'
                ? row.shop_category_tag
                : null,
            in_stock: row.in_stock !== false,
          })
        );
      }
      hasActiveShopEntitlement = shopEntitlementRes.data === true;

      if (restaurantProfileRes.data) {
        restaurantProfile = normalizeRestaurantProfileRow(
          restaurantProfileRes.data as Record<string, unknown>
        );
      }
      if (Array.isArray(restaurantMenuRes.data)) {
        restaurantMenuItems = restaurantMenuRes.data.map((row) =>
          normalizeMenuItemRow(row as Record<string, unknown>)
        );
      }
      hasActiveRestaurantEntitlement = restaurantEntitlementRes.data === true;

      if (realEstateProfileRes.data) {
        const rp = realEstateProfileRes.data as Record<string, unknown>;
        realEstateProfile = {
          ...(rp as unknown as ListingRealEstateProfile),
          price_inr: Number(rp.price_inr ?? 0),
          deposit_inr:
            rp.deposit_inr !== null && rp.deposit_inr !== undefined
              ? Number(rp.deposit_inr)
              : null,
          bedrooms:
            rp.bedrooms !== null && rp.bedrooms !== undefined
              ? Number(rp.bedrooms)
              : null,
          bathrooms:
            rp.bathrooms !== null && rp.bathrooms !== undefined
              ? Number(rp.bathrooms)
              : null,
          area_sqft:
            rp.area_sqft !== null && rp.area_sqft !== undefined
              ? Number(rp.area_sqft)
              : null,
        };

        try {
          const sessionCtx = await getServerSessionContext();
          if (sessionCtx.profile?.id) {
            const { data: visitRow } = await supabaseRead
              .from('property_visit_requests')
              .select('*')
              .eq('listing_id', listing.id)
              .eq('requester_id', String(sessionCtx.profile.id))
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (visitRow) {
              existingVisitRequest = visitRow as PropertyVisitRequest;
            }
          }
        } catch {
          // Non-blocking if unauthenticated
        }
      }

      const hubSwitches = (hubSwitchesRes.data as {
        module_switches?: Record<string, unknown> | null;
      } | null)?.module_switches;
      if (hubSwitches) {
        if (hubSwitches.shop_orders === false) isShopModuleEnabled = false;
        if (hubSwitches.food_orders === false) isFoodModuleEnabled = false;
        const reSw = hubSwitches.real_estate;
        if (
          reSw === false ||
          (reSw &&
            typeof reSw === 'object' &&
            (reSw as { enabled?: unknown }).enabled === false)
        ) {
          isRealEstateModuleEnabled = false;
        }
      }
    }
  } catch {
    // Non-blocking fallback if table/RPC not yet provisioned in preview
  }

  const isPrintingCategory = isListingInPrintingDigitalDomain({
    categorySlug: listing.categoryDetails?.slug || null,
    subcategory: listing.subcategory || null,
    title: listing.title || null,
    customTags: listing.custom_tags || null,
  });

  const printProvenanceTier: ListingProvenanceTier =
    Boolean(listing.businessRow?.verified) ||
    listing.verificationStatus === 'verified_demo'
      ? 'verified'
      : listing.ownerId
        ? 'claimed'
        : 'submitted';

  const providerClaimedServices: string[] = Array.from(
    new Set(
      [
        ...(Array.isArray(listing.custom_tags) ? listing.custom_tags : []),
        ...(Array.isArray(listing.businessDetails?.catalogue)
          ? listing.businessDetails!.catalogue
              .map((c) => c.name)
              .filter(Boolean)
          : []),
        ...(listing.subcategory ? [listing.subcategory] : []),
      ]
        .map((s) => String(s || '').trim())
        .filter((s) => s.length > 0 && s.length <= 42)
    )
  ).slice(0, 8);

  const indicativePriceNote =
    listing.serviceDetails?.startingPrice &&
    Number(listing.serviceDetails.startingPrice) > 0
      ? `Indicative starting price: ₹${Number(listing.serviceDetails.startingPrice).toLocaleString('en-IN')}`
      : null;

  const categoryLabel =
    listing.categoryDetails?.name ||
    LISTING_TYPE_DISPLAY_LABELS[listing.listing_type] ||
    CATEGORY_LABELS[listing.category] ||
    'Directory';

  const listingType = listing.listing_type;

  // 1. Business Specific Database Fields (`opening_hours`, `contact_phone`, `website_url`, `delivery_info`)
  const bizRow = listing.businessRow;
  const bizDetails = listing.businessDetails;
  const businessOpeningHours = formatOpeningHours(
    bizRow?.opening_hours,
    bizRow?.opening_hours_text || bizDetails?.openingHours
  );
  const businessContactPhone =
    bizRow?.contact_phone || listing.contactPhone || 'Not Provided';
  const businessWebsiteUrl = bizRow?.website_url || null;
  const businessVerified = Boolean(bizRow?.verified);
  const businessServiceRadiusText =
    bizRow?.delivery_info ||
    bizDetails?.deliveryInfo ||
    `10 km local delivery & service radius (${listing.locality} & Greater Lamka)`;

  // 2. Service Specific Database Fields (`service_radius_km`, `working_hours`, `pricing_model`, `starting_price`)
  const svcRow = listing.serviceRow;
  const svcDetails = listing.serviceDetails;
  const serviceOpeningHours = formatOpeningHours(
    svcRow?.working_hours,
    svcDetails?.workingHours || 'Mon – Sat: 8:30 AM – 6:30 PM'
  );
  const serviceRadiusKm =
    svcRow?.service_radius_km !== null &&
    svcRow?.service_radius_km !== undefined
      ? Number(svcRow.service_radius_km)
      : 15;
  const serviceAreasServed =
    Array.isArray(svcDetails?.areasServed) && svcDetails.areasServed.length > 0
      ? svcDetails.areasServed.join(', ')
      : `${listing.locality}, New Lamka, Tuibong, Rengkai & Hiangtam Lamka`;
  const servicePricingModel =
    svcRow?.pricing_model ||
    svcDetails?.priceRangeText ||
    svcDetails?.availabilityStatus ||
    'Standard Rate / Quote';
  const serviceStartingPrice =
    svcRow?.starting_price ??
    svcDetails?.startingPrice ??
    listing.price ??
    null;
  const serviceEmergencyAvailable = Boolean(svcRow?.emergency_service);

  // 3. Public Interest Specific Database Fields (`organization_type`, `is_emergency_facility`, `helpline_number`)
  const pubRow = listing.publicInterestRow;
  const pubDetails = listing.publicPlaceDetails;
  const publicOrganizationType =
    pubRow?.organization_type ||
    pubRow?.place_type ||
    pubDetails?.placeType ||
    listing.subcategory ||
    'Civic & Community Facility';
  const publicIsEmergencyFacility = Boolean(pubRow?.is_emergency_facility);
  const publicHelplineNumber =
    pubRow?.helpline_number ||
    pubDetails?.emergencyOrHelplineNote ||
    listing.contactPhone ||
    '112 / District Control Room';

  // 4. Real Estate Specific Database Fields (Property Size, Land Boundaries, Mandatory 360° Panorama)
  const reRow = listing.realEstateRow;
  const reDetails = listing.realEstateDetails;
  const rawPropertyType =
    reRow?.property_type || reDetails?.propertyType || listing.subcategory || 'Property';
  const formattedPropertyType =
    PROPERTY_TYPE_LABELS[rawPropertyType as PropertyType] ||
    rawPropertyType.toString().replace(/_/g, ' ');
  const resolvedPrice =
    reRow?.price ??
    reRow?.asking_price ??
    listing.price ??
    reDetails?.askingPrice ??
    null;
  const resolvedPriceLabel =
    reRow?.price_label ||
    reDetails?.priceLabel ||
    (resolvedPrice !== null
      ? `₹${Number(resolvedPrice).toLocaleString('en-IN')}`
      : 'Price on Request');
  const resolvedBedrooms = reRow?.bedrooms ?? reDetails?.bedrooms ?? null;
  const resolvedBathrooms = reRow?.bathrooms ?? reDetails?.bathrooms ?? null;
  const resolvedAreaSqm =
    reRow?.plot_area_sqm ??
    reDetails?.plotAreaSqm ??
    reRow?.built_up_area_sqm ??
    reDetails?.builtUpAreaSqm ??
    (reRow?.area_sqft ? Math.round(Number(reRow.area_sqft) / 10.7639) : 320);
  const resolvedAreaSqft =
    reRow?.area_sqft ??
    Math.round(Number(resolvedAreaSqm) * 10.7639);
  const resolvedDimensionsText =
    reDetails?.dimensionsText || '16m × 20m Standard Surveyed Parcel';
  const resolvedRoadAccessText =
    reDetails?.roadAccess || '20 ft Blacktopped Approach Road';
  const resolvedOwnershipLabel =
    reDetails?.ownershipLabel || 'Patta / Verified Local Land Record';
  const isRental = Boolean(reRow?.is_rental);
  const resolvedAvailability =
    reRow?.availability || reDetails?.availability || 'available';
  const resolvedAmenities =
    reRow?.amenities || reDetails?.amenities || [];
  const resolvedUtilities =
    reRow?.utilities || reDetails?.utilities || [];

  // Optional 360° Panorama Media Detection for Real Estate
  const panoramaMediaItems = (listing.listingMedia || []).filter(
    (m) => m.media_type === 'panorama_360' || m.is_equirectangular === true
  );
  const primaryPanoramaUrl =
    panoramaMediaItems.find((m) => Boolean(m?.url?.trim()))?.url?.trim() ||
    reDetails?.panoramas?.find((p) => Boolean(p?.imageUrl?.trim()))?.imageUrl?.trim() ||
    reDetails?.panoramaUrl?.trim() ||
    null;
  const has360PanoramaView = Boolean(primaryPanoramaUrl) || (Array.isArray(listing.panoramas_360) && listing.panoramas_360.length > 0);
  const namedPanoramaScenes: PublicPanorama360Scene[] = (() => {
    const rawJsonPanos = Array.isArray(listing.panoramas_360) ? listing.panoramas_360 : [];
    if (rawJsonPanos.length > 0) {
      return rawJsonPanos.filter((p) => Boolean(p?.url?.trim())).map((p, idx) => ({
        id: p.id || `pano-${idx + 1}`,
        label: p.label || `360° View ${idx + 1}`,
        url: p.url,
        width: p.width || 2048,
        height: p.height || 1024,
      }));
    }
    if (panoramaMediaItems.length > 0) {
      return panoramaMediaItems.filter((m) => Boolean(m?.url?.trim())).map((m, idx) => ({
        id: m.id || `media-pano-${idx + 1}`,
        label: m.caption || m.name || `360° View ${idx + 1}`,
        url: m.url,
      }));
    }
    if (Array.isArray(reDetails?.panoramas) && reDetails.panoramas.length > 0) {
      return reDetails.panoramas.filter((p) => Boolean(p?.imageUrl?.trim())).map((p, idx) => ({
        id: p.id || `re-pano-${idx + 1}`,
        label: p.name || `360° View ${idx + 1}`,
        url: p.imageUrl,
        width: p.width || 2048,
        height: p.height || 1024,
      }));
    }
    if (primaryPanoramaUrl) {
      return [{ id: 'pano-primary', label: 'Main 360° View', url: primaryPanoramaUrl }];
    }
    return [];
  })();
  const primaryPanoramaCaption =
    panoramaMediaItems[0]?.caption ||
    panoramaMediaItems[0]?.name ||
    reDetails?.panoramas?.[0]?.name ||
    `${listing.title} — 360° Equirectangular Property Tour`;

  // Standard Media Gallery Items
  const standardMediaItems = listing.listingMedia.filter(
    (m) =>
      m.media_type !== 'panorama_360' &&
      m.is_equirectangular !== true &&
      Boolean(m.url?.trim())
  );
  const fallbackGalleryUrls = [
    ...(listing.coverImage?.trim() ? [listing.coverImage.trim()] : []),
    ...(listing.galleryImages || []).map((u) => u?.trim()).filter(Boolean),
  ].filter((url, idx, arr) => Boolean(url) && arr.indexOf(url) === idx);

  const normalizedGalleryItems =
    standardMediaItems.length > 0
      ? standardMediaItems.map((m, idx) => ({
          id: m.id || `media-${idx}`,
          url: m.url.trim(),
          caption: m.caption || m.name || `${listing.title} — Image ${idx + 1}`,
          isPrimary: Boolean(m.is_primary) || idx === 0,
          mediaType: m.media_type || 'image',
        }))
      : fallbackGalleryUrls.map((url, idx) => ({
          id: `fallback-media-${idx}`,
          url,
          caption: `${listing.title} — Gallery Photo ${idx + 1}`,
          isPrimary: idx === 0,
          mediaType: 'image',
        }));

  // Property Land Boundary Polygon Data (uses stored survey vertices or derives parcel perimeter around coordinates)
  const effectiveBoundaryPoints =
    listing.boundaryPolygonPoints.length >= 3
      ? listing.boundaryPolygonPoints
      : [
          {
            lat: Number((listing.coordinates.lat + 0.00032).toFixed(6)),
            lng: Number((listing.coordinates.lng - 0.00038).toFixed(6)),
          },
          {
            lat: Number((listing.coordinates.lat + 0.00035).toFixed(6)),
            lng: Number((listing.coordinates.lng + 0.00036).toFixed(6)),
          },
          {
            lat: Number((listing.coordinates.lat - 0.00031).toFixed(6)),
            lng: Number((listing.coordinates.lng + 0.00039).toFixed(6)),
          },
          {
            lat: Number((listing.coordinates.lat - 0.00034).toFixed(6)),
            lng: Number((listing.coordinates.lng - 0.00035).toFixed(6)),
          },
        ];
  const polygonSvgData = buildPolygonSvgData(effectiveBoundaryPoints);

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 pt-2 pb-20 sm:px-6 lg:px-8 lg:pb-10">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Compact Conditional Sub-Navigation Pill */}
        <PageSubNavPill
          backHref={`/explore?focusLat=${encodeURIComponent(
            String(listing.coordinates.lat)
          )}&focusLng=${encodeURIComponent(String(listing.coordinates.lng))}`}
          backLabel="Back to Map"
          trailing={
            <>
              {manageWorkspaceHat && (
                <Link
                  href={`/workspace?hat=${manageWorkspaceHat}&listing=${encodeURIComponent(
                    listing.id
                  )}`}
                  data-testid="listing-detail-manage-workspace-pill"
                  className="inline-flex h-7 items-center gap-1.5 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-2.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 transition hover:bg-indigo-500/15"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  <span>Manage →</span>
                </Link>
              )}

              <Link
                href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(
                  listing.id
                )}`}
                data-testid="listing-detail-pick-n-drop-btn"
                className="inline-flex h-7 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-2.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Pick N Drop</span>
              </Link>
            </>
          }
        >
          <div className="hidden sm:block min-w-0">
            <Breadcrumbs
              items={[
                {
                  label: 'Explore',
                  href: '/explore',
                },
                {
                  label: categoryLabel,
                  href: `/explore?category=${encodeURIComponent(listing.category)}`,
                },
                {
                  label: listing.title,
                },
              ]}
            />
          </div>
        </PageSubNavPill>

        {/* Cross-Hub Deep Link Banner */}
        <CrossHubBanner
          itemHubId={listing.hub_id}
          itemTypeLabel="listing"
        />

        {/* Pass R3: Calm Temporarily Closed / Archived Notice for non-active lifecycle_status */}
        {listing.lifecycle_status && listing.lifecycle_status !== 'active' && (
          <div
            role="status"
            data-testid="listing-lifecycle-closed-banner"
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong className="font-bold">Temporarily Closed / Archived:</strong>{' '}
              This listing is not currently accepting new public discovery orders. Existing orders and receipts remain accessible in your Activity ledger.
            </span>
          </div>
        )}

        {/* Hero Overview Header */}
        <header className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-accent-fg)]">
                  {listingType === 'business' && (
                    <Briefcase className="h-3.5 w-3.5" />
                  )}
                  {listingType === 'service' && (
                    <Wrench className="h-3.5 w-3.5" />
                  )}
                  {listingType === 'real_estate' && (
                    <Home className="h-3.5 w-3.5" />
                  )}
                  {(listingType === 'public_interest' ||
                    listingType === 'public_place') && (
                    <Landmark className="h-3.5 w-3.5" />
                  )}
                  {listingType === 'sports' && (
                    <Trophy className="h-3.5 w-3.5" />
                  )}
                  <span>{categoryLabel}</span>
                </span>

                <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="capitalize">{listing.status}</span>
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)]">
                {listing.title}
              </h1>

              <p className="flex items-center gap-1.5 text-xs text-[var(--ps-text-muted)]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                <span>
                  {listing.address} • {listing.locality}
                </span>
              </p>
            </div>

            {/* Contact & Coordinates Pill */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-xs space-y-1.5 min-w-[220px]">
              <div className="font-bold text-[var(--ps-text)]">
                Contact &amp; Location
              </div>
              {listing.contactPhone && (
                <div className="flex items-center gap-1.5 text-[var(--ps-text-muted)]">
                  <Phone className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span>{listing.contactPhone}</span>
                </div>
              )}
              {listing.contactEmail && (
                <div className="flex items-center gap-1.5 text-[var(--ps-text-muted)]">
                  <Mail className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span>{listing.contactEmail}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)] pt-1 border-t border-[var(--ps-border)]">
                <Compass className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                <span>
                  {listing.coordinates.lat.toFixed(4)}° N,{' '}
                  {listing.coordinates.lng.toFixed(4)}° E
                </span>
              </div>
            </div>
          </div>

          {listing.description && (
            <div className="pt-2 border-t border-[var(--ps-border)]">
              <RichTextDisplay html={listing.description} className="text-sm leading-relaxed text-[var(--ps-text)]" />
            </div>
          )}
        </header>

        {/* Pass V13-B: Multi-View Named 360° Panorama Viewer with Clickable View Switcher Pills */}
        {namedPanoramaScenes.length > 0 && (
          <Panorama360Viewer
            scenes={namedPanoramaScenes}
            listingTitle={listing.title}
            coordinates={listing.coordinates}
          />
        )}
        {Boolean(false) && listing.description && (
            <p className="text-sm leading-relaxed text-[var(--ps-text)] pt-2 border-t border-[var(--ps-border)]">
              {listing.description}
            </p>
          )}

        {/* Phase 71-D: 3-Tier Print & Digital Service Card (Official PrintSwift / Subscribed Print Pro / Free Basic Print Listing) */}
        <PrintServiceCard
          listingId={listing.id}
          listingTitle={listing.title}
          listingLocality={listing.locality}
          profile={printProfile}
          hasActiveEntitlement={hasActivePrintEntitlement}
          isPrintingCategory={isPrintingCategory}
          provenanceTier={printProvenanceTier}
          providerClaimedServices={providerClaimedServices}
          indicativePriceNote={indicativePriceNote}
          contactPhone={listing.contactPhone}
          whatsappPhone={listing.contactPhone}
          isPrintModuleEnabled={isPrintModuleEnabled}
        />

        {/* Phase 73-C: Dedicated Venue & Hotel Service Cards */}
        {isBookingVenueVertical && (
          <BookingServiceCard
            listingId={listing.id}
            resources={bookingResources}
            hasActiveEntitlement={hasActiveBookingEntitlement}
          />
        )}
        {isHotelStayVertical && (
          <HotelServiceCard
            listingId={listing.id}
            hotelProfile={hotelProfile}
            rooms={bookingResources}
            hasActiveEntitlement={hasActiveBookingEntitlement}
          />
        )}

        {/* Phase 74-C: Dedicated Shop Storefront & Restaurant Digital Menu */}
        {isShopCatalogueVertical && shopProfile && (
          <ShopStorefrontClient
            listingId={listing.id}
            listingTitle={listing.title}
            listingLocality={listing.locality}
            listingLat={listing.coordinates.lat}
            listingLng={listing.coordinates.lng}
            contactPhone={listing.contactPhone || null}
            profile={shopProfile}
            products={shopProducts}
            hasActiveEntitlement={hasActiveShopEntitlement}
            isModuleEnabled={isShopModuleEnabled}
          />
        )}
        {isRestaurantFoodVertical && restaurantProfile && (
          <RestaurantMenuClient
            listingId={listing.id}
            listingTitle={listing.title}
            listingLocality={listing.locality}
            listingLat={listing.coordinates.lat}
            listingLng={listing.coordinates.lng}
            contactPhone={listing.contactPhone || null}
            profile={restaurantProfile}
            menuItems={restaurantMenuItems}
            hasActiveEntitlement={hasActiveRestaurantEntitlement}
            isModuleEnabled={isFoodModuleEnabled}
          />
        )}

        {/* Phase 75-C1: Lightweight Real Estate Pro Detail & Controlled Site Visit */}
        {isRealEstateVertical && realEstateProfile && (
          <RealEstateDetailClient
            listingId={listing.id}
            listingTitle={listing.title}
            listingLocality={listing.locality}
            contactPhone={listing.contactPhone || null}
            profile={realEstateProfile}
            existingVisitRequest={existingVisitRequest}
            isModuleEnabled={isRealEstateModuleEnabled}
          />
        )}

        {/* Conditional Category-Specific Sections (Only when no specialized vertical client is active) */}

        {/* 1. BUSINESS DETAILS (Opening Hours, Contact Details, Service/Delivery Radius & Commercial Info) */}
        {!isBookingVenueVertical &&
          !isHotelStayVertical &&
          !(isShopCatalogueVertical && shopProfile) &&
          !(isRestaurantFoodVertical && restaurantProfile) &&
          !(isRealEstateVertical && realEstateProfile) &&
          listingType === 'business' && (
          <section
            data-testid="detail-section-business"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-sky-600" />
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Business Opening Hours, Contact Details &amp; Service Radius
                </h2>
              </div>
              {businessVerified && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:text-sky-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Verified Business</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {/* Opening Hours */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Clock className="h-3.5 w-3.5 text-sky-600" />
                  <span>Opening Hours</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {businessOpeningHours}
                </p>
              </div>

              {/* Contact Details */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Phone className="h-3.5 w-3.5 text-sky-600" />
                  <span>Contact Details</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {businessContactPhone}
                </p>
                {listing.contactEmail && (
                  <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                    {listing.contactEmail}
                  </p>
                )}
              </div>

              {/* Service & Delivery Radius */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Radar className="h-3.5 w-3.5 text-sky-600" />
                  <span>Service &amp; Delivery Radius</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {businessServiceRadiusText}
                </p>
              </div>

              {/* Website URL */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Globe className="h-3.5 w-3.5 text-sky-600" />
                  <span>Website &amp; Address</span>
                </span>
                {businessWebsiteUrl ? (
                  <a
                    href={businessWebsiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-extrabold text-sky-600 hover:underline break-all"
                  >
                    <span>{businessWebsiteUrl}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  <p className="text-sm font-bold text-[var(--ps-text)]">
                    {listing.locality}, Churachandpur
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 2. SERVICE DETAILS (Opening Hours, Contact Details, Service Radius & Pricing) */}
        {/* 2. SERVICE DETAILS (Service Areas, Pricing & Contact Hours) */}
        {!isBookingVenueVertical &&
          !isHotelStayVertical &&
          !(isShopCatalogueVertical && shopProfile) &&
          !(isRestaurantFoodVertical && restaurantProfile) &&
          !(isRealEstateVertical && realEstateProfile) &&
          listingType === 'service' && (
          <section
            data-testid="detail-section-service"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-violet-600" />
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Service Opening Hours, Contact Details &amp; Service Radius
                </h2>
              </div>
              {serviceEmergencyAvailable && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Emergency Callout Available</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {/* Opening / Working Hours */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Clock className="h-3.5 w-3.5 text-violet-600" />
                  <span>Opening Hours</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {serviceOpeningHours}
                </p>
              </div>

              {/* Contact Details */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Phone className="h-3.5 w-3.5 text-violet-600" />
                  <span>Contact Details</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {listing.contactPhone}
                </p>
                {listing.contactEmail && (
                  <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                    {listing.contactEmail}
                  </p>
                )}
              </div>

              {/* Service Radius (km) */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Radar className="h-3.5 w-3.5 text-violet-600" />
                  <span>Service Radius</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {serviceRadiusKm} km coverage radius
                </p>
                <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                  {serviceAreasServed}
                </p>
              </div>

              {/* Pricing Model & Starting Rate */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <IndianRupee className="h-3.5 w-3.5 text-violet-600" />
                  <span>Rate &amp; Pricing Model</span>
                </span>
                <p className="text-sm font-extrabold text-violet-600 dark:text-violet-400">
                  {serviceStartingPrice !== null
                    ? `From ₹${Number(serviceStartingPrice).toLocaleString('en-IN')}`
                    : servicePricingModel.toString().replace(/_/g, ' ')}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 3. REAL ESTATE DETAILS (Property Size, Land Boundaries & Optional 360° Panorama Viewer) */}
        {!(isRealEstateVertical && realEstateProfile) &&
          listingType === 'real_estate' && (
          <div className="space-y-6">
            {/* 3A. Property Size & Specifications Section */}
            <section
              data-testid="detail-section-real-estate"
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <div className="flex items-center gap-2">
                  <Home className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-[var(--ps-text)]">
                    Property Size, Dimensions &amp; Real Estate Specifications
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 capitalize">
                    {isRental ? 'For Rent / Lease' : 'For Sale'} •{' '}
                    {resolvedAvailability.toString().replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
                {/* Property Size (sq.ft & m²) */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <Maximize2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Property Size</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)]">
                    {Number(resolvedAreaSqft).toLocaleString('en-IN')} sq.ft.
                  </p>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    ({Number(resolvedAreaSqm).toLocaleString('en-IN')} m²)
                  </p>
                </div>

                {/* Parcel Dimensions */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <Layers className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Plot Dimensions</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)]">
                    {resolvedDimensionsText}
                  </p>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    {resolvedRoadAccessText}
                  </p>
                </div>

                {/* Property Type */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <Tag className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Property Type</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)] capitalize">
                    {formattedPropertyType}
                  </p>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    {reRow?.tenure || reDetails?.tenure || resolvedOwnershipLabel}
                  </p>
                </div>

                {/* Price */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Asking Price</span>
                  </span>
                  <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                    {resolvedPriceLabel}
                  </p>
                </div>

                {/* Bedrooms */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <BedDouble className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Bedrooms</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)]">
                    {resolvedBedrooms !== null
                      ? `${resolvedBedrooms} BHK / Beds`
                      : 'N/A (Land / Plot)'}
                  </p>
                </div>

                {/* Bathrooms */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <Bath className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Bathrooms</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)]">
                    {resolvedBathrooms !== null
                      ? `${resolvedBathrooms} Bath(s)`
                      : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Amenities & Utilities Pills */}
              {(resolvedAmenities.length > 0 ||
                resolvedUtilities.length > 0) && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-[var(--ps-border)] text-xs">
                  {resolvedAmenities.length > 0 && (
                    <div className="space-y-2">
                      <span className="font-bold text-[var(--ps-text)]">
                        Property Amenities
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {resolvedAmenities.map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--ps-text)]"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span>{item}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {resolvedUtilities.length > 0 && (
                    <div className="space-y-2">
                      <span className="font-bold text-[var(--ps-text)]">
                        Available Utilities &amp; Infrastructure
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {resolvedUtilities.map((util) => (
                          <span
                            key={util}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--ps-text)]"
                          >
                            <CheckCircle2 className="h-3 w-3 text-sky-600" />
                            <span>{util}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 3B. Optional 360° Panorama Virtual Tour Section (only when valid panorama exists) */}
            {has360PanoramaView && primaryPanoramaUrl && (
              <section
                data-testid="detail-section-panorama-360"
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-emerald-600" />
                    <h2 className="text-base font-bold text-[var(--ps-text)]">
                      360° Virtual Property Panorama Viewer
                    </h2>
                  </div>
                  <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    Equirectangular 360° Panorama ({panoramaMediaItems.length || 1}{' '}
                    Scene)
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-slate-950 relative">
                  <iframe
                    src={primaryPanoramaUrl}
                    title={primaryPanoramaCaption}
                    sandbox="allow-scripts allow-same-origin"
                    loading="lazy"
                    className="h-72 sm:h-96 w-full border-0"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/95 px-4 py-2.5 text-xs text-slate-200 border-t border-slate-800">
                    <span className="font-semibold truncate">
                      {primaryPanoramaCaption}
                    </span>
                    <span className="text-[11px] text-emerald-400 font-mono">
                      media_type: panorama_360
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* 3C. Land Boundaries Survey Map Section */}
            {polygonSvgData && (
              <section
                data-testid="detail-section-boundary-map"
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-emerald-600" />
                    <h2 className="text-base font-bold text-[var(--ps-text)]">
                      Land Boundaries &amp; Cadastral Parcel Survey Map
                    </h2>
                  </div>
                  <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                    {effectiveBoundaryPoints.length} Survey Vertices • Centered
                    at {polygonSvgData.centerLat}° N, {polygonSvgData.centerLng}°
                    E
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-slate-900 p-4 text-white">
                  <svg
                    viewBox={`0 0 ${polygonSvgData.width} ${polygonSvgData.height}`}
                    role="img"
                    aria-label={`Read-only property boundary polygon map for ${listing.title}`}
                    className="h-64 w-full rounded-xl bg-slate-950/90 border border-slate-800"
                  >
                    <defs>
                      <pattern
                        id="detail-boundary-grid"
                        width="32"
                        height="32"
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d="M 32 0 L 0 0 0 32"
                          fill="none"
                          stroke="rgba(148, 163, 184, 0.12)"
                          strokeWidth="1"
                        />
                      </pattern>
                    </defs>
                    <rect
                      width={polygonSvgData.width}
                      height={polygonSvgData.height}
                      fill="url(#detail-boundary-grid)"
                    />

                    {/* Property Boundary Polygon */}
                    <polygon
                      points={polygonSvgData.svgPointsString}
                      fill="rgba(16, 185, 129, 0.25)"
                      stroke="#10b981"
                      strokeWidth="2.5"
                    />

                    {/* Survey Vertices */}
                    {polygonSvgData.projected.map((pt, idx) => (
                      <circle
                        key={`${pt.lat}-${pt.lng}-${idx}`}
                        cx={pt.x}
                        cy={pt.y}
                        r="4"
                        fill="#f59e0b"
                        stroke="#0f172a"
                        strokeWidth="1.5"
                      />
                    ))}
                  </svg>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                    <span>
                      Read-only cadastral / plot perimeter preview centered on
                      parcel geometry ({Number(resolvedAreaSqm).toLocaleString('en-IN')} m²).
                    </span>
                    <span className="font-mono text-[11px] text-emerald-400">
                      SRID 4326 • {listing.locality}
                    </span>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* 4. PUBLIC INTEREST DETAILS (`organization_type`, `is_emergency_facility`, `helpline_number`) */}
        {(listingType === 'public_interest' ||
          listingType === 'public_place') && (
          <section
            data-testid="detail-section-public-interest"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-rose-600" />
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Public Interest &amp; Community Institution Details
                </h2>
              </div>
              {publicIsEmergencyFacility && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Designated Emergency Facility</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
              {/* Organization Type */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Building2 className="h-3.5 w-3.5 text-rose-600" />
                  <span>Organization Type</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)] capitalize">
                  {publicOrganizationType.toString().replace(/_/g, ' ')}
                </p>
              </div>

              {/* Emergency Facility Status */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                  <span>Emergency Facility Status</span>
                </span>
                <p
                  className={`text-sm font-extrabold ${
                    publicIsEmergencyFacility
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-[var(--ps-text)]'
                  }`}
                >
                  {publicIsEmergencyFacility
                    ? 'Yes — 24/7 Emergency Response'
                    : 'No — Standard Public Facility'}
                </p>
              </div>

              {/* Helpline Number */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <PhoneCall className="h-3.5 w-3.5 text-rose-600" />
                  <span>Helpline Number</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {publicHelplineNumber}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 5. SPORTS VENUE DETAILS */}
        {!isBookingVenueVertical && listingType === 'sports' && (
          <section
            data-testid="detail-section-sports"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
          >
            <div className="flex items-center gap-2 border-b border-[var(--ps-border)] pb-3">
              <Trophy className="h-5 w-5 text-orange-600" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Sports &amp; Recreation Venue Details
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1">
                <span className="text-[var(--ps-text-muted)] font-medium">
                  Sport Activity &amp; Venue Category
                </span>
                <p className="font-bold text-[var(--ps-text)]">
                  {listing.sportsDetails?.sportActivity ||
                    listing.subcategory ||
                    'Multi-Sport Facility'}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1">
                <span className="text-[var(--ps-text-muted)] font-medium">
                  Surface &amp; Capacity
                </span>
                <p className="font-bold text-[var(--ps-text)]">
                  {listing.sportsDetails?.surfaceType || 'Standard Court'}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1">
                <span className="text-[var(--ps-text-muted)] font-medium">
                  Operating Hours
                </span>
                <p className="font-bold text-[var(--ps-text)]">
                  {listing.sportsDetails?.openingHours || '6:00 AM – 9:00 PM'}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Standard Image Gallery & Carousel Showcase (`listing_media`) */}
        <section
          data-testid="detail-section-media"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                {listingType !== 'real_estate' || !primaryPanoramaUrl
                  ? 'Standard Photo Gallery & Media Showcase'
                  : 'Supplemental Listing Media & Photos'}
              </h2>
            </div>
            <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
              {normalizedGalleryItems.length} Standard Image(s)
            </span>
          </div>

          {normalizedGalleryItems.length > 0 ? (
            <div className="space-y-4">
              {/* Featured Primary Image Showcase */}
              <div className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                <div className="relative h-64 sm:h-80 w-full bg-slate-900 flex items-center justify-center overflow-hidden">
                  {normalizedGalleryItems[0]?.url ? (
                    <Image
                      src={normalizedGalleryItems[0].url}
                      alt={normalizedGalleryItems[0].caption}
                      fill
                      priority
                      sizes="(max-width: 1024px) 100vw, 960px"
                      referrerPolicy="no-referrer"
                      className="object-cover"
                    />
                  ) : null}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-lg bg-slate-950/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-xs">
                    <ImageIcon className="h-3.5 w-3.5 text-amber-400" />
                    <span>Featured Cover Media</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs border-t border-[var(--ps-border)]">
                  <span className="font-semibold text-[var(--ps-text)] truncate">
                    {normalizedGalleryItems[0].caption}
                  </span>
                  <span className="text-[11px] uppercase font-mono text-[var(--ps-text-muted)]">
                    {normalizedGalleryItems[0].mediaType}
                  </span>
                </div>
              </div>

              {/* Horizontally Scrollable / Grid Thumbnail Strip */}
              {normalizedGalleryItems.length > 1 && (
                <div
                  data-testid="standard-media-gallery-grid"
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                >
                  {normalizedGalleryItems.map((media, idx) => (
                    <div
                      key={media.id}
                      className="group overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] transition hover:border-[var(--ps-accent)]"
                    >
                      <div className="relative h-28 w-full bg-slate-900 overflow-hidden">
                        {media.url ? (
                          <Image
                            src={media.url}
                            alt={media.caption}
                            fill
                            priority={false}
                            sizes="(max-width: 640px) 50vw, 25vw"
                            referrerPolicy="no-referrer"
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : null}
                        {media.isPrimary && (
                          <span className="absolute top-2 right-2 rounded bg-[var(--ps-accent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent-fg)]">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 text-xs space-y-0.5">
                        <p className="font-semibold text-[var(--ps-text)] truncate">
                          {media.caption}
                        </p>
                        <p className="text-[10px] text-[var(--ps-text-muted)]">
                          Photo {idx + 1} of {normalizedGalleryItems.length}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
              No standard gallery images found in{' '}
              <code className="font-mono">listing_media</code> for this listing.
            </div>
          )}
        </section>

        {/* Community Reviews, Average Rating & Owner Replies */}
        <ReviewSection listingId={listing.id} listingTitle={listing.title} />

        {/* Direct Owner Enquiry & Messaging Form */}
        <EnquiryForm listingId={listing.id} listingTitle={listing.title} />
      </div>
    </main>
  );
}
