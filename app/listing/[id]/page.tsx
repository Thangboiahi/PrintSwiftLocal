import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
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
  Wrench,
} from 'lucide-react';
import { EnquiryForm } from '@/components/discovery/EnquiryForm';
import { ReviewSection } from '@/components/discovery/ReviewSection';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
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
      title: 'Listing Not Found | PrintSwift Local',
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
    `Explore ${listing.title} (${categoryName}) in ${listing.locality}, Churachandpur on PrintSwift Local.`;

  return {
    title: `${listing.title} — ${categoryName} | PrintSwift Local`,
    description: summary,
    openGraph: {
      title: `${listing.title} | PrintSwift Local`,
      description: summary,
      type: 'website',
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

  const categoryLabel =
    listing.categoryDetails?.name ||
    LISTING_TYPE_DISPLAY_LABELS[listing.listing_type] ||
    CATEGORY_LABELS[listing.category] ||
    'Directory';

  const listingType = listing.listing_type;

  // 1. Business Specific Database Fields (`opening_hours`, `contact_phone`, `website_url`)
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

  // 2. Service Specific Database Fields (`service_radius_km`, `pricing_model`, `starting_price`)
  const svcRow = listing.serviceRow;
  const svcDetails = listing.serviceDetails;
  const serviceRadiusKm =
    svcRow?.service_radius_km !== null &&
    svcRow?.service_radius_km !== undefined
      ? Number(svcRow.service_radius_km)
      : null;
  const servicePricingModel =
    svcRow?.pricing_model ||
    svcDetails?.priceRangeText ||
    svcDetails?.availabilityStatus ||
    'Standard Rate / Quote';
  const serviceStartingPrice =
    svcRow?.starting_price ?? svcDetails?.startingPrice ?? null;
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

  // 4. Real Estate Specific Database Fields
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
  const resolvedAreaSqft =
    reRow?.area_sqft ??
    (reRow?.plot_area_sqm
      ? Math.round(Number(reRow.plot_area_sqm) * 10.7639)
      : reDetails?.plotAreaSqm
        ? Math.round(reDetails.plotAreaSqm * 10.7639)
        : reDetails?.builtUpAreaSqm
          ? Math.round(reDetails.builtUpAreaSqm * 10.7639)
          : null);
  const resolvedAreaSqm =
    reRow?.plot_area_sqm ??
    reDetails?.plotAreaSqm ??
    reRow?.built_up_area_sqm ??
    reDetails?.builtUpAreaSqm ??
    (reRow?.area_sqft ? Math.round(Number(reRow.area_sqft) / 10.7639) : null);
  const isRental = Boolean(reRow?.is_rental);
  const resolvedAvailability =
    reRow?.availability || reDetails?.availability || 'available';
  const resolvedAmenities =
    reRow?.amenities || reDetails?.amenities || [];
  const resolvedUtilities =
    reRow?.utilities || reDetails?.utilities || [];

  // 360° Panorama Media Detection (`media_type === 'panorama_360'`)
  const panoramaMediaItems = listing.listingMedia.filter(
    (m) => m.media_type === 'panorama_360' || m.is_equirectangular === true
  );
  const primaryPanoramaUrl =
    panoramaMediaItems[0]?.url ||
    reDetails?.panoramas?.[0]?.imageUrl ||
    null;
  const primaryPanoramaCaption =
    panoramaMediaItems[0]?.caption ||
    panoramaMediaItems[0]?.name ||
    reDetails?.panoramas?.[0]?.name ||
    `${listing.title} — 360° Equirectangular Tour`;

  // Standard Media Gallery Items (for all non-real-estate listings, or real-estate without 360 panorama, plus general gallery)
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

  // Property Boundary Polygon Data
  const polygonSvgData = buildPolygonSvgData(listing.boundaryPolygonPoints);

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Top Bar with Breadcrumbs and Back Link */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Breadcrumbs
            items={[
              {
                label: categoryLabel,
                href: `/?category=${listing.category}`,
              },
              {
                label: listing.title,
              },
            ]}
          />

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Map</span>
          </Link>
        </div>

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
            <p className="text-sm leading-relaxed text-[var(--ps-text)] pt-2 border-t border-[var(--ps-border)]">
              {listing.description}
            </p>
          )}
        </header>

        {/* Conditional Category-Specific Sections */}

        {/* 1. BUSINESS DETAILS (`opening_hours`, `contact_phone`, `website_url`) */}
        {listingType === 'business' && (
          <section
            data-testid="detail-section-business"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-sky-600" />
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Business &amp; Commercial Information
                </h2>
              </div>
              {businessVerified && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:text-sky-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Verified Business</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
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

              {/* Contact Phone */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Phone className="h-3.5 w-3.5 text-sky-600" />
                  <span>Business Contact Phone</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {businessContactPhone}
                </p>
              </div>

              {/* Website URL */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Globe className="h-3.5 w-3.5 text-sky-600" />
                  <span>Website URL</span>
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
                  <p className="text-sm font-bold text-[var(--ps-text-muted)]">
                    No external website listed
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 2. SERVICE DETAILS (`service_radius_km`, `pricing_model`, `starting_price`) */}
        {listingType === 'service' && (
          <section
            data-testid="detail-section-service"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-violet-600" />
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Service Coverage, Pricing Model &amp; Rates
                </h2>
              </div>
              {serviceEmergencyAvailable && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Emergency Callout Available</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
              {/* Service Radius (km) */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Radar className="h-3.5 w-3.5 text-violet-600" />
                  <span>Service Radius</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)]">
                  {serviceRadiusKm !== null
                    ? `${serviceRadiusKm} km coverage radius`
                    : 'District-wide (Churachandpur)'}
                </p>
              </div>

              {/* Pricing Model */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <Tag className="h-3.5 w-3.5 text-violet-600" />
                  <span>Pricing Model</span>
                </span>
                <p className="text-sm font-extrabold text-[var(--ps-text)] capitalize">
                  {servicePricingModel.toString().replace(/_/g, ' ')}
                </p>
              </div>

              {/* Starting Price */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                  <IndianRupee className="h-3.5 w-3.5 text-violet-600" />
                  <span>Starting Price</span>
                </span>
                <p className="text-sm font-extrabold text-violet-600 dark:text-violet-400">
                  {serviceStartingPrice !== null
                    ? `₹${Number(serviceStartingPrice).toLocaleString('en-IN')}`
                    : 'Contact for Estimate'}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 3. REAL ESTATE DETAILS (`bedrooms`, `bathrooms`, `area_sqft`, `property_type`, `price`, 360 Tour, Boundary Map) */}
        {listingType === 'real_estate' && (
          <div className="space-y-6">
            <section
              data-testid="detail-section-real-estate"
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <div className="flex items-center gap-2">
                  <Home className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-[var(--ps-text)]">
                    Property Specifications &amp; Real Estate Metrics
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 capitalize">
                    {isRental ? 'For Rent / Lease' : 'For Sale'} •{' '}
                    {resolvedAvailability.toString().replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 text-xs">
                {/* Property Type */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <Tag className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Property Type</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)] capitalize">
                    {formattedPropertyType}
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

                {/* Area (sqft & m²) */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
                    <Maximize2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Total Area</span>
                  </span>
                  <p className="text-sm font-extrabold text-[var(--ps-text)]">
                    {resolvedAreaSqft !== null
                      ? `${Number(resolvedAreaSqft).toLocaleString('en-IN')} sq.ft.`
                      : 'Survey Pending'}
                  </p>
                  {resolvedAreaSqm !== null && (
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      ({Number(resolvedAreaSqm).toLocaleString('en-IN')} m²)
                    </p>
                  )}
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

            {/* 360° Panorama Virtual Tour Section */}
            {primaryPanoramaUrl && (
              <section
                data-testid="detail-section-panorama-360"
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-emerald-600" />
                    <h2 className="text-base font-bold text-[var(--ps-text)]">
                      360° Virtual Property Tour
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

            {/* Read-Only Secondary Property Boundary Map Block */}
            {polygonSvgData && (
              <section
                data-testid="detail-section-boundary-map"
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-emerald-600" />
                    <h2 className="text-base font-bold text-[var(--ps-text)]">
                      Property Boundary Survey Map (Read-Only)
                    </h2>
                  </div>
                  <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                    {listing.boundaryPolygonPoints.length} Survey Vertices •
                    Centered at {polygonSvgData.centerLat}° N,{' '}
                    {polygonSvgData.centerLng}° E
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
                      parcel geometry.
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
        {listingType === 'sports' && (
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={normalizedGalleryItems[0].url}
                      alt={normalizedGalleryItems[0].caption}
                      className="h-full w-full object-cover"
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
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={media.url}
                            alt={media.caption}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
