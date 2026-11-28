import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Globe,
  Home,
  IndianRupee,
  Landmark,
  Layers,
  Mail,
  MapPin,
  Maximize2,
  Megaphone,
  Navigation,
  Phone,
  PhoneCall,
  Radar,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  Trophy,
  Truck,
  Wrench,
} from 'lucide-react';
import { EnquiryForm } from '@/components/discovery/EnquiryForm';
import { ReviewSection } from '@/components/discovery/ReviewSection';
import { CrossHubBanner } from '@/components/hub/CrossHubBanner';
import { ListingDetailHeroClient } from '@/components/listing/ListingDetailHeroClient';
import {
  PrintServiceCard,
  type ListingProvenanceTier,
} from '@/components/listing/PrintServiceCard';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { PageSubNavPill } from '@/components/navigation/PageSubNavPill';
import { RichTextDisplay } from '@/components/ui/RichTextEditor';
import { type PublicPanorama360Scene } from '@/components/verticals/Panorama360Viewer';
import { BookingServiceCard } from '@/components/verticals/bookings/BookingServiceCard';
import { HotelServiceCard } from '@/components/verticals/hotels/HotelServiceCard';
import { RealEstateDetailClient } from '@/components/verticals/real-estate/RealEstateDetailClient';
import { RestaurantMenuClient } from '@/components/verticals/restaurants/RestaurantMenuClient';
import {
  ShopStorefrontClient,
  type StorefrontProductItem,
} from '@/components/verticals/shops/ShopStorefrontClient';
import { getServerSessionContext } from '@/lib/auth-server';
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
import type {
  ListingRealEstateProfile,
  PropertyVisitRequest,
} from '@/lib/real-estate/types';
import { CATEGORY_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/rules';
import {
  DEFAULT_LISTING_PUBLIC_CAPABILITIES,
  fetchListingPublicCapabilities,
  type ListingPublicCapabilities,
} from '@/lib/subscriptions/public-capabilities';
import { fetchListingById } from '@/lib/supabase/listings';
import { resolveListingRootKey } from '@/lib/taxonomy/categories';
import type { PropertyType } from '@/lib/types';
import { deriveListingPriceLabel } from '@/lib/utils/share';

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

  const resolvedOgImageUrl =
    primaryImageUrl || `${baseUrl}/icons/icon-512x512.png`;

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
      images: [
        {
          url: resolvedOgImageUrl,
          width: primaryImageUrl ? 1200 : 512,
          height: primaryImageUrl ? 630 : 512,
          alt: primaryImageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${listing.title} | DD oodle`,
      description: summary,
      images: [resolvedOgImageUrl],
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

  // v16b: Bind listing detail layout strictly to canonical Level-1 System Root (`root_key`)
  const effectiveRootKey = resolveListingRootKey(
    listing.root_key || listing.listing_vertical,
    listing.category,
    listing.is_civic_record
  );

  // Pass R3: Public & Civic records terminate in CivicSummaryModal on /explore
  if (effectiveRootKey === 'public_civic' || listing.is_civic_record) {
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
  let publicCapabilities: ListingPublicCapabilities =
    DEFAULT_LISTING_PUBLIC_CAPABILITIES;
  let hasPublicCapabilitiesRpc = false;
  let ownerBulletins: Array<{
    id: string;
    title: string;
    category: string;
    excerpt: string;
    created_at: string;
  }> = [];
  let relatedMarketplaceItems: Array<{
    id: string;
    title: string;
    price: number;
    unit_label: string | null;
    listing_id: string;
  }> = [];
  let nearbySimilarListings: Array<{
    id: string;
    title: string;
    locality: string;
    category: string;
    subcategory: string | null;
    cover_image: string | null;
    rating: number;
    is_verified: boolean;
    price: number | null;
  }> = [];

  const isBookingVenueVertical = effectiveRootKey === 'booking_venue';
  const isHotelStayVertical = effectiveRootKey === 'hotel_stay';
  const isShopCatalogueVertical = effectiveRootKey === 'shop_catalogue';
  const isRestaurantFoodVertical = effectiveRootKey === 'restaurant_food';
  const isRealEstateVertical = effectiveRootKey === 'real_estate';

  try {
    const supabaseRead = createServerSupabaseReadClient();
    if (supabaseRead) {
      const nowIso = new Date().toISOString();
      const bulletinFilter = listing.ownerId
        ? `linked_listing_id.eq.${listing.id},author_id.eq.${listing.ownerId}`
        : `linked_listing_id.eq.${listing.id}`;

      let nearbyQuery = supabaseRead
        .from('listings')
        .select(
          'id, title, locality, category, subcategory, cover_image, rating, is_verified, price, paid_until'
        )
        .neq('id', listing.id)
        .eq('status', 'published')
        .or(`paid_until.is.null,paid_until.gt.${nowIso}`)
        .order('rating', { ascending: false })
        .limit(12);
      if (listing.hub_id) {
        nearbyQuery = nearbyQuery.eq('hub_id', listing.hub_id);
      }

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
        publicCapabilitiesRes,
        ownerBulletinsRes,
        relatedMarketplaceRes,
        nearbyListingsRes,
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
        fetchListingPublicCapabilities(supabaseRead, listing.id),
        supabaseRead
          .from('bulletins')
          .select('id, title, category, excerpt, created_at')
          .eq('status', 'published')
          .or(bulletinFilter)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order('created_at', { ascending: false })
          .limit(3),
        supabaseRead
          .from('marketplace_products')
          .select('id, title, price, unit_label, listing_id')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .limit(4),
        nearbyQuery,
      ]);

      publicCapabilities = publicCapabilitiesRes.capabilities;
      hasPublicCapabilitiesRpc = publicCapabilitiesRes.fromRpc;

      if (Array.isArray(ownerBulletinsRes.data)) {
        ownerBulletins = (
          ownerBulletinsRes.data as Array<Record<string, unknown>>
        ).map((row) => ({
          id: String(row.id),
          title: String(row.title ?? 'Bulletin Notice'),
          category: String(row.category ?? 'notice'),
          excerpt: String(row.excerpt ?? ''),
          created_at: String(row.created_at ?? ''),
        }));
      }

      if (Array.isArray(relatedMarketplaceRes.data)) {
        relatedMarketplaceItems = (
          relatedMarketplaceRes.data as Array<Record<string, unknown>>
        ).map((row) => ({
          id: String(row.id),
          title: String(row.title ?? 'Item'),
          price: Number(row.price ?? 0),
          unit_label:
            typeof row.unit_label === 'string' ? row.unit_label : null,
          listing_id: String(row.listing_id ?? listing.id),
        }));
      }

      if (Array.isArray(nearbyListingsRes.data)) {
        const currentLoc = (listing.locality || '').trim().toLowerCase();
        const currentCat = (listing.category || '').trim().toLowerCase();
        nearbySimilarListings = (
          nearbyListingsRes.data as Array<Record<string, unknown>>
        )
          .map((row) => ({
            id: String(row.id),
            title: String(row.title ?? 'Local Listing'),
            locality: String(row.locality ?? listing.locality ?? ''),
            category: String(row.category ?? ''),
            subcategory:
              typeof row.subcategory === 'string' ? row.subcategory : null,
            cover_image:
              typeof row.cover_image === 'string' ? row.cover_image : null,
            rating: Number(row.rating ?? 0),
            is_verified: Boolean(row.is_verified),
            price:
              row.price !== null && row.price !== undefined
                ? Number(row.price)
                : null,
          }))
          .sort((a, b) => {
            const scoreA =
              (a.locality.trim().toLowerCase() === currentLoc ? 2 : 0) +
              (a.category.trim().toLowerCase() === currentCat ? 2 : 0);
            const scoreB =
              (b.locality.trim().toLowerCase() === currentLoc ? 2 : 0) +
              (b.category.trim().toLowerCase() === currentCat ? 2 : 0);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return b.rating - a.rating;
          })
          .slice(0, 4);
      }

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
      } else if (isShopCatalogueVertical) {
        shopProfile = normalizeShopProfileRow({
          listing_id: listing.id,
          hub_id: listing.hub_id || 'churachandpur',
        });
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
      } else if (isRestaurantFoodVertical) {
        restaurantProfile = normalizeRestaurantProfileRow({
          listing_id: listing.id,
          hub_id: listing.hub_id || 'churachandpur',
        });
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

        // v21a (P0-16): enforce `contact_reveal_policy` SERVER-SIDE — gated owner contact
        // never reaches the HTML/RSC payload until the viewer's visit is accepted & revealed.
        const contactUnlocked =
          realEstateProfile.contact_reveal_policy === 'direct_call' ||
          Boolean(
            existingVisitRequest &&
              existingVisitRequest.status === 'accepted' &&
              existingVisitRequest.contact_revealed
          );
        if (!contactUnlocked) {
          listing.contactPhone = '';
          listing.contactEmail = '';
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
  const heroPriceLabel = deriveListingPriceLabel(listing);
  const heroIsVerified = Boolean(
    listing.is_verified ||
      listing.businessRow?.verified ||
      realEstateProfile?.patta_verified ||
      realEstateProfile?.site_verified ||
      shopProfile?.store_verified ||
      restaurantProfile?.fssai_verified ||
      listing.verificationStatus === 'verified_demo'
  );

  const realEstateBoundaryGeoJson =
    (realEstateProfile as unknown as Record<string, unknown> | null)
      ?.boundary_geojson ??
    (listing.vertical_summary as Record<string, unknown> | undefined)
      ?.boundary_geojson ??
    null;

  const crossLinkProducts =
    shopProducts.length > 0
      ? shopProducts.slice(0, 4).map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          unit_label: p.unit_label || p.unit,
          listing_id: listing.id,
        }))
      : relatedMarketplaceItems.slice(0, 4);

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 pt-2 pb-20 sm:px-6 lg:px-8 lg:pb-10">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Compact Conditional Sub-Navigation Pill */}
        <PageSubNavPill
          backHref={`/explore?vertical=${encodeURIComponent(
            effectiveRootKey
          )}&category=${encodeURIComponent(
            listing.category
          )}&focusLat=${encodeURIComponent(
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
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-3 text-xs font-bold text-indigo-700 dark:text-indigo-300 transition hover:bg-indigo-500/15"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  <span>Manage →</span>
                </Link>
              )}

              {(!hasPublicCapabilitiesRpc || publicCapabilities.can_dispatch_pnd) && (
                <Link
                  href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(
                    listing.id
                  )}`}
                  data-testid="listing-detail-pick-n-drop-btn"
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
                >
                  <Truck className="h-3.5 w-3.5" />
                  <span>Pick N Drop</span>
                </Link>
              )}
            </>
          }
        >
          <div className="min-w-0 overflow-x-auto no-scrollbar">
            <Breadcrumbs
              items={[
                {
                  label: 'Explore',
                  href: '/explore',
                },
                {
                  label:
                    ({
                      shop_catalogue: 'Shops',
                      restaurant_food: 'Food & Dining',
                      booking_venue: 'Venues & Turf',
                      hotel_stay: 'Stays & Hotels',
                      print_digital: 'Print & Digital',
                      real_estate: 'Real Estate',
                      public_civic: 'Public & Civic',
                      general: 'Directory',
                    } as Record<string, string>)[effectiveRootKey] ||
                    'Directory',
                  href: `/explore?vertical=${encodeURIComponent(effectiveRootKey)}`,
                },
                {
                  label: categoryLabel,
                  href: `/explore?vertical=${encodeURIComponent(
                    effectiveRootKey
                  )}&category=${encodeURIComponent(listing.category)}`,
                },
                ...(listing.subcategory &&
                listing.subcategory.trim().toLowerCase() !==
                  categoryLabel.trim().toLowerCase()
                  ? [
                      {
                        label: listing.subcategory.trim(),
                        href: `/explore?vertical=${encodeURIComponent(
                          effectiveRootKey
                        )}&category=${encodeURIComponent(
                          listing.category
                        )}&q=${encodeURIComponent(listing.subcategory.trim())}`,
                      },
                    ]
                  : []),
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
        <header className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 shadow-xs space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_270px] lg:items-start">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/explore?vertical=${encodeURIComponent(
                    effectiveRootKey
                  )}&category=${encodeURIComponent(listing.category)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-accent-fg)] transition hover:opacity-90"
                >
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
                </Link>

                {heroIsVerified && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Verified</span>
                  </span>
                )}

                {heroPriceLabel && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 font-mono text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {heroPriceLabel}
                  </span>
                )}

                {listing.rating > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 tabular-nums">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span>{Number(listing.rating).toFixed(1)}</span>
                    {listing.reviewCount > 0 && (
                      <span className="opacity-75">({listing.reviewCount})</span>
                    )}
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight text-[var(--ps-text)] leading-tight">
                {listing.title}
              </h1>

              <p className="flex items-start gap-1.5 text-xs text-[var(--ps-text-muted)]">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                <span>
                  {listing.address && listing.address !== listing.locality
                    ? `${listing.address} • ${listing.locality}`
                    : listing.locality}
                </span>
              </p>
            </div>

            {/* Compact Contact & Coordinates Card */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-xs space-y-1.5">
              <div className="font-bold text-[var(--ps-text)]">
                Contact &amp; Location
              </div>
              {listing.contactPhone && (
                <a
                  href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
                  className="flex items-center gap-1.5 font-semibold text-[var(--ps-text)] hover:text-[var(--ps-accent)] transition-colors"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                  <span className="truncate">{listing.contactPhone}</span>
                </a>
              )}
              {listing.contactEmail && (
                <a
                  href={`mailto:${listing.contactEmail}`}
                  className="flex items-center gap-1.5 text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] transition-colors"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                  <span className="truncate">{listing.contactEmail}</span>
                </a>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)] pt-1 border-t border-[var(--ps-border)] tabular-nums">
                <Compass className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                <span>
                  {listing.coordinates.lat.toFixed(4)}° N,{' '}
                  {listing.coordinates.lng.toFixed(4)}° E
                </span>
              </div>
            </div>
          </div>

          {listing.description && (
            <div className="pt-3 border-t border-[var(--ps-border)]">
              <RichTextDisplay
                html={listing.description}
                className="text-sm leading-relaxed text-[var(--ps-text)]"
              />
            </div>
          )}
        </header>

        {/* Swipeable Media Hero (Photo Gallery + 360° Panorama Tab) & 44px+ Action Bar */}
        <div data-testid="detail-section-media">
          <ListingDetailHeroClient
            listingId={listing.id}
            title={listing.title}
            categoryLabel={categoryLabel}
            verticalRootKey={effectiveRootKey}
            locality={listing.locality}
            address={listing.address}
            coordinates={listing.coordinates}
            contactPhone={listing.contactPhone || null}
            priceLabel={heroPriceLabel}
            rating={listing.rating}
            reviewCount={listing.reviewCount}
            isVerified={heroIsVerified}
            ownerName={listing.ownerName}
            ownerAvatar={listing.ownerAvatarUrl}
            galleryItems={normalizedGalleryItems}
            panoramaScenes={namedPanoramaScenes}
            canShow360={
              !hasPublicCapabilitiesRpc || publicCapabilities.can_show_360
            }
            canDispatchPnd={
              !hasPublicCapabilitiesRpc || publicCapabilities.can_dispatch_pnd
            }
          />
        </div>

        {/* Phase 71-D + V17b: 3-Tier Print & Digital Service Card */}
        <PrintServiceCard
          listingId={listing.id}
          listingTitle={listing.title}
          listingLocality={listing.locality}
          profile={printProfile}
          hasActiveEntitlement={
            hasPublicCapabilitiesRpc
              ? publicCapabilities.can_order_print ||
                Boolean(printProfile?.is_first_party_printswift)
              : hasActivePrintEntitlement
          }
          isPrintingCategory={isPrintingCategory}
          provenanceTier={printProvenanceTier}
          providerClaimedServices={providerClaimedServices}
          indicativePriceNote={indicativePriceNote}
          contactPhone={listing.contactPhone}
          whatsappPhone={listing.contactPhone}
          isPrintModuleEnabled={isPrintModuleEnabled}
        />

        {/* Phase 73-C + V17b: Dedicated Venue & Hotel Service Cards */}
        {isBookingVenueVertical && (
          <BookingServiceCard
            listingId={listing.id}
            resources={bookingResources}
            hasActiveEntitlement={
              hasPublicCapabilitiesRpc
                ? publicCapabilities.can_book_online
                : hasActiveBookingEntitlement
            }
          />
        )}
        {isHotelStayVertical && (
          <HotelServiceCard
            listingId={listing.id}
            hotelProfile={hotelProfile}
            rooms={bookingResources}
            hasActiveEntitlement={
              hasPublicCapabilitiesRpc
                ? publicCapabilities.can_book_online
                : hasActiveBookingEntitlement
            }
          />
        )}

        {/* Phase 74-C + V17b: Dedicated Shop Storefront & Restaurant Digital Menu */}
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
            hasActiveEntitlement={
              hasPublicCapabilitiesRpc
                ? hasActiveShopEntitlement &&
                  publicCapabilities.can_show_marketplace
                : hasActiveShopEntitlement
            }
            isModuleEnabled={isShopModuleEnabled}
            canPayUpi={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_pay_upi : true
            }
            canPayManual={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_pay_manual : true
            }
            canDispatchPnd={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_dispatch_pnd : true
            }
            escrowRequired={
              hasPublicCapabilitiesRpc ? publicCapabilities.escrow_required : false
            }
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
            canPayUpi={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_pay_upi : true
            }
            canPayManual={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_pay_manual : true
            }
            canDispatchPnd={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_dispatch_pnd : true
            }
            canBookTable={
              hasPublicCapabilitiesRpc ? publicCapabilities.can_book_online : true
            }
            escrowRequired={
              hasPublicCapabilitiesRpc ? publicCapabilities.escrow_required : false
            }
          />
        )}

        {/* Phase 75-C1: Lightweight Real Estate Pro Detail & Controlled Site Visit */}
        {isRealEstateVertical && realEstateProfile && (
          <div id="request-visit">
            <RealEstateDetailClient
              listingId={listing.id}
              listingTitle={listing.title}
              listingLocality={listing.locality}
              contactPhone={listing.contactPhone || null}
              profile={realEstateProfile}
              existingVisitRequest={existingVisitRequest}
              isModuleEnabled={isRealEstateModuleEnabled}
            />
          </div>
        )}

        {/* Conditional Category-Specific Sections (Only when no specialized vertical client is active) */}

        {/* 1. BUSINESS DETAILS */}
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
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Clock className="h-3.5 w-3.5 text-sky-600" />
                  <span>Opening Hours</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {businessOpeningHours}
                </p>
              </div>

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

              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Radar className="h-3.5 w-3.5 text-sky-600" />
                  <span>Service &amp; Delivery Radius</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {businessServiceRadiusText}
                </p>
              </div>

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
                    {listing.address && listing.address !== listing.locality
                      ? `${listing.locality}, ${listing.address}`
                      : listing.locality}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 2. SERVICE DETAILS */}
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
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Clock className="h-3.5 w-3.5 text-violet-600" />
                  <span>Opening Hours</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {serviceOpeningHours}
                </p>
              </div>

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

        {/* 3. REAL ESTATE DETAILS (Fallback specs when no realEstateProfile row exists yet) */}
        {!(isRealEstateVertical && realEstateProfile) &&
          listingType === 'real_estate' && (
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

              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Asking Price</span>
                </span>
                <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                  {resolvedPriceLabel}
                </p>
              </div>

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

            {(resolvedAmenities.length > 0 || resolvedUtilities.length > 0) && (
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
        )}

        {/* 4. PUBLIC INTEREST DETAILS */}
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
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Building2 className="h-3.5 w-3.5 text-rose-600" />
                  <span>Organization Type</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)] capitalize">
                  {publicOrganizationType.toString().replace(/_/g, ' ')}
                </p>
              </div>

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

        {/* Shared Interactive Location, Logistics & Polygon Map */}
        <section
          data-testid="detail-section-boundary-map"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 shadow-xs space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Location, Hours &amp; Logistics</span>
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)]">
                {listing.locality}
                {listing.address ? ` · ${listing.address}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                  `${listing.coordinates.lat},${listing.coordinates.lng}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
              >
                <Navigation className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Get Directions</span>
              </a>
              {(!hasPublicCapabilitiesRpc || publicCapabilities.can_dispatch_pnd) && (
                <Link
                  href={`/pick-n-drop?dropoffLat=${encodeURIComponent(
                    String(listing.coordinates.lat)
                  )}&dropoffLng=${encodeURIComponent(
                    String(listing.coordinates.lng)
                  )}&dropoffLabel=${encodeURIComponent(
                    listing.locality ? `${listing.title}, ${listing.locality}` : listing.title
                  )}`}
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
                >
                  <Truck className="h-4 w-4" />
                  <span>Book Pick N Drop</span>
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Operating Hours
                </span>
                <p className="font-semibold text-[var(--ps-text)]">
                  {businessOpeningHours ||
                    serviceOpeningHours ||
                    listing.sportsDetails?.openingHours ||
                    'Daily local business hours'}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Address &amp; Landmark
                </span>
                <p className="font-semibold text-[var(--ps-text)]">
                  {listing.address || `${listing.locality}, Churachandpur`}
                </p>
              </div>
            </div>
          </div>

          <DynamicListingLocationMap
            listingId={listing.id}
            title={listing.title}
            locality={listing.locality}
            address={listing.address}
            coordinates={listing.coordinates}
            listingVertical={effectiveRootKey}
            boundaryPolygon={
              isRealEstateVertical || listingType === 'real_estate'
                ? listing.realEstateDetails?.boundaryPolygon ||
                  (listing.boundaryPolygonPoints.length >= 3
                    ? listing.boundaryPolygonPoints
                    : effectiveBoundaryPoints)
                : listing.boundaryPolygonPoints
            }
            boundaryGeoJson={realEstateBoundaryGeoJson}
            secondaryBoundaryGeoJson={listing.boundary_geojson}
            areaSqft={
              realEstateProfile?.area_sqft ??
              (isRealEstateVertical || listingType === 'real_estate'
                ? Number(resolvedAreaSqft)
                : null)
            }
            landAreaText={realEstateProfile?.land_area_text || null}
            pattaStatus={
              realEstateProfile?.patta_status ||
              (isRealEstateVertical || listingType === 'real_estate'
                ? 'verified_patta'
                : null)
            }
            pattaVerified={Boolean(realEstateProfile?.patta_verified)}
            showExactPin={
              realEstateProfile ? Boolean(realEstateProfile.show_exact_pin) : true
            }
          />
        </section>

        {/* Organic Cross-Linking Hub: Related Marketplace Items, Owner Bulletins, Pick N Drop & Category Discovery */}
        <section
          data-testid="detail-section-cross-links"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div>
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Explore Connected Local Services &amp; Feeds
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Related marketplace items, active owner bulletins, and Pick N Drop dispatch from {listing.locality}
              </p>
            </div>
            <Link
              href={`/explore?vertical=${encodeURIComponent(
                effectiveRootKey
              )}&category=${encodeURIComponent(listing.category)}`}
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-bold text-[var(--ps-text)] transition hover:border-[var(--ps-accent)]/50"
            >
              <span>More in {categoryLabel}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* 1. Related Marketplace Items */}
            <div className="flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[var(--ps-text)]">
                    <ShoppingBag className="h-4 w-4 text-sky-600" />
                    <span>Marketplace Items</span>
                  </span>
                  <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                    {shopProducts.length > 0 ? 'This Store' : 'Local Hub'}
                  </span>
                </div>
                {crossLinkProducts.length > 0 ? (
                  <ul className="space-y-1.5 text-xs">
                    {crossLinkProducts.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5"
                      >
                        <Link
                          href={
                            item.listing_id === listing.id
                              ? `/marketplace?q=${encodeURIComponent(item.title)}`
                              : `/listing/${encodeURIComponent(item.listing_id)}`
                          }
                          className="truncate font-semibold text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
                        >
                          {item.title}
                        </Link>
                        <span className="shrink-0 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                          ₹{Number(item.price).toLocaleString('en-IN')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Browse verified shop catalogues, digital restaurant menus, and express print services across the hub.
                  </p>
                )}
              </div>
              <Link
                href="/marketplace"
                className="inline-flex min-h-[44px] h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-bold text-[var(--ps-text)] transition hover:border-[var(--ps-accent)]/50"
              >
                <ShoppingBag className="h-3.5 w-3.5 text-sky-600" />
                <span>Browse Marketplace</span>
              </Link>
            </div>

            {/* 2. Owner's Active Bulletins */}
            <div className="flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[var(--ps-text)]">
                    <Megaphone className="h-4 w-4 text-amber-600" />
                    <span>Bulletins &amp; Notices</span>
                  </span>
                  <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    {ownerBulletins.length > 0
                      ? `${ownerBulletins.length} Active`
                      : 'Community Feed'}
                  </span>
                </div>
                {ownerBulletins.length > 0 ? (
                  <ul className="space-y-1.5 text-xs">
                    {ownerBulletins.map((b) => (
                      <li
                        key={b.id}
                        className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5"
                      >
                        <Link
                          href={`/bulletin?post=${encodeURIComponent(b.id)}`}
                          className="block truncate font-semibold text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
                        >
                          {b.title}
                        </Link>
                        <span className="text-[10px] uppercase font-bold text-[var(--ps-text-muted)]">
                          {b.category}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Check announcements, job openings, local events, and special offers posted on the community bulletin board.
                  </p>
                )}
              </div>
              <Link
                href={
                  ownerBulletins[0]
                    ? `/bulletin?post=${encodeURIComponent(ownerBulletins[0].id)}`
                    : `/bulletin?q=${encodeURIComponent(listing.locality)}`
                }
                className="inline-flex min-h-[44px] h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-bold text-[var(--ps-text)] transition hover:border-[var(--ps-accent)]/50"
              >
                <Megaphone className="h-3.5 w-3.5 text-amber-600" />
                <span>View Bulletin Board</span>
              </Link>
            </div>

            {/* 3. Pick N Drop ("Send/Receive from here") */}
            <div className="flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[var(--ps-text)]">
                    <Truck className="h-4 w-4 text-emerald-600" />
                    <span>Pick N Drop Runner</span>
                  </span>
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    Live Dispatch
                  </span>
                </div>
                <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                  Need a parcel, print order, or takeaway picked up from{' '}
                  <strong className="text-[var(--ps-text)]">{listing.title}</strong>{' '}
                  in {listing.locality} and delivered to your doorstep?
                </p>
              </div>
              <Link
                href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(
                  listing.id
                )}`}
                className="inline-flex min-h-[44px] h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Send / Receive from Here</span>
              </Link>
            </div>
          </div>

          {/* 4. Nearby & Similar Listings in Locality */}
          {nearbySimilarListings.length > 0 && (
            <div className="border-t border-[var(--ps-border)] pt-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Nearby &amp; Similar in {listing.locality}
                </h3>
                <Link
                  href={`/explore?q=${encodeURIComponent(listing.locality)}`}
                  className="text-xs font-bold text-[var(--ps-accent)] hover:underline"
                >
                  Explore area →
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {nearbySimilarListings.map((sim) => (
                  <Link
                    key={sim.id}
                    href={`/listing/${encodeURIComponent(sim.id)}`}
                    className="group flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 transition hover:border-[var(--ps-accent)]/60 hover:shadow-xs"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5 text-[10px]">
                        <span className="truncate rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 font-bold text-[var(--ps-text-muted)]">
                          {sim.subcategory ||
                            CATEGORY_LABELS[
                              sim.category as keyof typeof CATEGORY_LABELS
                            ] ||
                            sim.category.replace(/_/g, ' ')}
                        </span>
                        {sim.rating > 0 && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 font-bold text-amber-500 tabular-nums">
                            <Star className="h-3 w-3 fill-current" />
                            {sim.rating.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-extrabold text-[var(--ps-text)] line-clamp-2 group-hover:text-[var(--ps-accent)] transition-colors">
                        {sim.title}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-1.5 pt-2 border-t border-[var(--ps-border)]/70 text-[11px]">
                      <span className="inline-flex items-center gap-1 truncate text-[var(--ps-text-muted)]">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{sim.locality}</span>
                      </span>
                      {sim.price && sim.price > 0 ? (
                        <span className="shrink-0 font-mono font-bold text-[var(--ps-text)] tabular-nums">
                          ₹{Math.round(sim.price).toLocaleString('en-IN')}
                        </span>
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                      )}
                    </div>
                  </Link>
                ))}
              </div>
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
