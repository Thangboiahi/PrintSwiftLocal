'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Clock,
  ExternalLink,
  Flag,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Search,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { PanoramaViewer360 } from '@/components/real-estate/PanoramaViewer360';
import { PropertyBoundaryMap } from '@/components/real-estate/PropertyBoundaryMap';
import {
  formatArea,
  shouldShowBuildingParameters,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { useAppStore } from '@/lib/store';
import { AreaUnit, Listing } from '@/lib/types';

interface CategoryDetailViewProps {
  listing: Listing;
  mode: 'full_page' | 'map_expanded' | 'modal';
  apiKeyAvailable?: boolean;
  backLabel?: string;
  onBackToMap?: () => void;
  onClose?: () => void;
  onLocateOnMap?: (listing: Listing) => void;
  onOpenFullPage?: (listingId: string) => void;
  onSelectRelatedListing?: (listingId: string) => void;
}

export function CategoryDetailView({
  listing,
  mode,
  apiKeyAvailable: propApiKeyAvailable,
  backLabel,
  onBackToMap,
  onClose,
  onLocateOnMap,
  onOpenFullPage,
  onSelectRelatedListing,
}: CategoryDetailViewProps) {
  const apiKeyAvailable =
    propApiKeyAvailable ??
    Boolean(
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY &&
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY !== 'MY_GOOGLE_MAPS_API_KEY'
    );
  const handleCloseOrBack = () => {
    if (onBackToMap) {
      onBackToMap();
    } else if (onClose) {
      onClose();
    }
  };
  const {
    listings,
    savedListingIds,
    toggleSavedListing,
    recordListingInteraction,
    reviews,
    submitVisitorReview,
    reportReview,
    submitVisitorEnquiry,
    areaUnit,
    setAreaUnit,
    dynamicFields,
    platformSettings,
    currentUser,
    saveListing,
  } = useAppStore();

  // Catalogue search & filter state (for Businesses)
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueCategory, setCatalogueCategory] = useState('all');

  // Demo Enquiry form state
  const [enqName, setEnqName] = useState('');
  const [enqPhone, setEnqPhone] = useState('');
  const [enqEmail, setEnqEmail] = useState('');
  const [enqMessage, setEnqMessage] = useState('');
  const [enqSubmitted, setEnqSubmitted] = useState(false);

  // Demo Review form state
  const [revName, setRevName] = useState('');
  const [revRating, setRevRating] = useState(5);
  const [revComment, setRevComment] = useState('');
  const [revSubmitted, setRevSubmitted] = useState(false);

  const isSaved = savedListingIds.includes(listing.id);

  const listingReviews = useMemo(
    () =>
      reviews.filter(
        (r) => r.listingId === listing.id && r.moderationStatus !== 'hidden'
      ),
    [reviews, listing.id]
  );

  const relatedListings = useMemo(
    () =>
      listings
        .filter(
          (l) =>
            l.category === listing.category &&
            l.id !== listing.id &&
            l.status === 'published'
        )
        .slice(0, 3),
    [listings, listing.category, listing.id]
  );

  const categoryCustomFields = useMemo(
    () =>
      dynamicFields.filter(
        (df) => df.category === listing.category && df.publicVisible
      ),
    [dynamicFields, listing.category]
  );

  // Catalogue filtering for Business listings
  const catalogueProducts = useMemo(
    () => listing.businessDetails?.catalogue || [],
    [listing.businessDetails?.catalogue]
  );
  const catalogueCategories = useMemo(
    () =>
      Array.from(new Set(catalogueProducts.map((p) => p.category))),
    [catalogueProducts]
  );
  const filteredCatalogue = useMemo(() => {
    const q = catalogueQuery.trim().toLowerCase();
    return catalogueProducts.filter((p) => {
      if (catalogueCategory !== 'all' && p.category !== catalogueCategory)
        return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [catalogueProducts, catalogueQuery, catalogueCategory]);

  const handleEnquirySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!enqName.trim() || !enqMessage.trim()) return;
    submitVisitorEnquiry({
      listingId: listing.id,
      listingTitle: listing.title,
      ownerId: listing.ownerId,
      senderName: enqName.trim(),
      senderPhone: enqPhone.trim() || '+91 90000 00000',
      senderEmail: enqEmail.trim() || 'visitor@sample-printswift.local',
      message: enqMessage.trim(),
      source:
        mode === 'map_expanded' || mode === 'modal'
          ? 'Map Preview'
          : listing.category === 'real_estate'
            ? '360° Property Tour'
            : 'Detail Page',
    });
    setEnqSubmitted(true);
    setEnqName('');
    setEnqPhone('');
    setEnqEmail('');
    setEnqMessage('');
  };

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!revName.trim() || !revComment.trim()) return;
    submitVisitorReview(listing.id, revName.trim(), revRating, revComment.trim());
    setRevSubmitted(true);
    setRevName('');
    setRevComment('');
  };

  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${listing.coordinates.lat},${listing.coordinates.lng}`;

  const re = listing.realEstateDetails;
  const showPlotAndBoundary = re
    ? shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot)
    : false;
  const showBuildingParams = re
    ? shouldShowBuildingParameters(re.propertyType)
    : false;

  const resolvedBackLabel =
    backLabel ||
    (mode === 'modal' ? 'Close Preview' : 'Back to Map Discovery');

  return (
    <div className="bg-[var(--ps-bg)] text-[var(--ps-text)] min-h-full">
      {/* 1. Large Cover Photo that scrolls away naturally */}
      <div className="relative h-56 sm:h-72 lg:h-80 w-full overflow-hidden bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.coverImage}
          alt={listing.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

        {/* Top navigation bar inside media header */}
        <div className="absolute top-3 left-4 right-4 flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="full-detail-back-btn"
            onClick={handleCloseOrBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950/80 hover:bg-slate-950 text-white text-xs font-medium backdrop-blur-xs border border-white/15"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{resolvedBackLabel}</span>
          </button>

          <div className="flex items-center gap-2">
            {onLocateOnMap && (
              <button
                type="button"
                data-testid="full-detail-locate-on-map-btn"
                onClick={() => onLocateOnMap(listing)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-950 hover:bg-slate-100 text-xs font-semibold shadow-xs"
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                <span>Locate on Map</span>
              </button>
            )}
            {(mode === 'map_expanded' || mode === 'modal') && onOpenFullPage && (
              <button
                type="button"
                onClick={() => onOpenFullPage(listing.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-950 hover:bg-slate-100 text-xs font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Full Detail Page</span>
              </button>
            )}
            {(mode === 'map_expanded' || mode === 'modal') && (
              <button
                type="button"
                onClick={handleCloseOrBack}
                aria-label="Close expanded details"
                className="p-1.5 rounded-lg bg-slate-950/80 text-white hover:bg-slate-950 border border-white/15"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="absolute bottom-4 left-4 right-4 text-white">
          <div className="text-xs text-slate-300 flex flex-wrap items-center gap-1.5">
            <span>{listing.subcategory}</span>
            <span aria-hidden="true">·</span>
            <span>{listing.locality}</span>
            <span aria-hidden="true">·</span>
            <span>Synthetic Sample Record</span>
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight mt-1">
            {listing.title}
          </h1>
        </div>
      </div>

      {/* 2. Compact Sticky Summary Header (scrolls naturally and sticks cleanly at top) */}
      <div className="sticky top-0 z-20 bg-[var(--ps-surface)]/95 backdrop-blur-md border-b border-[var(--ps-border)] px-4 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-semibold text-[var(--ps-text)] truncate">
                {listing.title}
              </h2>
              <span className="text-xs text-[var(--ps-text-muted)] hidden sm:inline">
                · {listing.locality}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--ps-text-muted)] tabular-nums">
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <Star className="w-3.5 h-3.5 fill-current" />
                {listing.rating} ({listing.reviewCount} sample reviews)
              </span>
              {re && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-[var(--ps-text)]">
                    {re.priceLabel}
                  </span>
                </>
              )}
              {listing.serviceDetails && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-[var(--ps-text)]">
                    From ₹{listing.serviceDetails.startingPrice}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onLocateOnMap && (
              <button
                type="button"
                data-testid="detail-sticky-locate-on-map-btn"
                onClick={() => onLocateOnMap(listing)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] text-xs font-medium transition-colors whitespace-nowrap"
              >
                <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                <span>Locate on Map</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleSavedListing(listing.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                isSaved
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>{isSaved ? 'Saved' : 'Save Listing'}</span>
            </button>

            <a
              href={googleDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                recordListingInteraction(listing.id, 'directionClicksCount')
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-medium hover:opacity-90 whitespace-nowrap"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Directions</span>
            </a>
          </div>
        </div>
      </div>

      {/* 3. Main Category-Specific Detail Content */}
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-8">
        {/* Mandatory 360° Panorama prominently near cover photo ONLY for Real Estate */}
        {listing.category === 'real_estate' && re && (
          <section aria-label="Real Estate 360 Panorama Section" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--ps-text)]">
                Compulsory 360° Property Panorama
              </h3>
              <span className="text-xs text-[var(--ps-text-muted)]">
                Equirectangular 2:1 Demonstration Media
              </span>
            </div>
            <PanoramaViewer360
              panoramas={re.panoramas}
              propertyTitle={listing.title}
              coordinates={listing.coordinates}
              streetViewAvailable={re.streetViewAvailable}
            />
          </section>
        )}

        {/* Two-column layout: Primary Category Details + Sidebar Contact/Enquiry */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6">
            {/* Overview & Verification Disclaimer */}
            <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-[var(--ps-text)]">
                  About This {listing.subcategory}
                </h3>
                <span className="text-xs text-[var(--ps-text-muted)] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  {listing.verificationStatus === 'verified_demo'
                    ? 'Demo Verified Record (Synthetic)'
                    : 'Unverified Sample Record'}
                </span>
              </div>
              <p className="text-sm text-[var(--ps-text)] leading-relaxed">
                {listing.description}
              </p>
              <div className="pt-2 border-t border-[var(--ps-border)] flex flex-wrap items-center gap-4 text-xs text-[var(--ps-text-muted)]">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {listing.address}
                </span>
                <span className="font-mono tabular-nums">
                  ({listing.coordinates.lat.toFixed(5)},{' '}
                  {listing.coordinates.lng.toFixed(5)})
                </span>
              </div>
            </section>

            {/* ============================================================== */}
            {/* CATEGORY A: REAL ESTATE SPECIALISED CONDITIONAL PARAMETERS      */}
            {/* ============================================================== */}
            {listing.category === 'real_estate' && re && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--ps-text)]">
                      Property Specifications ({listing.subcategory})
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Fields automatically tailored to property type:{' '}
                      <code>{re.propertyType}</code>
                    </p>
                  </div>

                  {/* Area Unit Switcher (Default m²) */}
                  <div className="flex items-center gap-1 bg-[var(--ps-bg)] p-1 rounded-lg border border-[var(--ps-border)]">
                    {(
                      [
                        { id: 'sqm', label: 'm² (Default)' },
                        { id: 'sqft', label: 'ft²' },
                        { id: 'acre', label: 'Acres' },
                        { id: 'hectare', label: 'Hectares' },
                      ] as Array<{ id: AreaUnit; label: string }>
                    ).map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setAreaUnit(u.id)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          areaUnit === u.id
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                            : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                        }`}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 1. Plot / Land Area Section — ONLY shown for plot_land, house_with_plot, villa_with_land */}
                {showPlotAndBoundary && (
                  <div className="p-4 rounded-lg bg-[var(--ps-surface-alt)]/60 border border-[var(--ps-border)] space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[var(--ps-text)]">
                        Plot &amp; Land Parameters (Canonical Default: m²)
                      </h4>
                      <span className="text-[11px] text-[var(--ps-text-muted)]">
                        Associated Plot Included
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Plot Area</div>
                        <div className="text-sm font-bold text-[var(--ps-text)] tabular-nums mt-0.5">
                          {formatArea(re.plotAreaSqm, areaUnit)}
                        </div>
                        {areaUnit !== 'sqm' && (
                          <div className="text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                            Canonical: {formatArea(re.plotAreaSqm, 'sqm')}
                          </div>
                        )}
                      </div>
                      {re.landType && (
                        <div>
                          <div className="text-[var(--ps-text-muted)]">Land Classification</div>
                          <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                            {re.landType}
                          </div>
                        </div>
                      )}
                      {re.dimensionsText && (
                        <div>
                          <div className="text-[var(--ps-text-muted)]">Sample Dimensions</div>
                          <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                            {re.dimensionsText}
                          </div>
                        </div>
                      )}
                      {re.roadAccess && (
                        <div>
                          <div className="text-[var(--ps-text-muted)]">Road Access</div>
                          <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                            {re.roadAccess}
                          </div>
                        </div>
                      )}
                      {re.roadFrontageMeters !== undefined && (
                        <div>
                          <div className="text-[var(--ps-text-muted)]">Road Frontage</div>
                          <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                            {re.roadFrontageMeters} m
                          </div>
                        </div>
                      )}
                      {re.terrainSlope && (
                        <div>
                          <div className="text-[var(--ps-text-muted)]">Terrain / Slope</div>
                          <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                            {re.terrainSlope}
                          </div>
                        </div>
                      )}
                    </div>
                    {re.ownershipLabel && (
                      <p className="text-[11px] text-[var(--ps-text-muted)] pt-2 border-t border-[var(--ps-border)]">
                        Ownership Status: {re.ownershipLabel}
                      </p>
                    )}
                  </div>
                )}

                {/* 2. Building / Residence / Apartment / Commercial / PG Parameters */}
                {showBuildingParams && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    {re.builtUpAreaSqm !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">
                          Internal / Built-Up Floor Area (Not Land Area)
                        </div>
                        <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                          {formatArea(re.builtUpAreaSqm, areaUnit)}
                        </div>
                      </div>
                    )}
                    {re.bedrooms !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Bedrooms</div>
                        <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                          {re.bedrooms} BHK
                        </div>
                      </div>
                    )}
                    {re.bathrooms !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Bathrooms</div>
                        <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                          {re.bathrooms}
                        </div>
                      </div>
                    )}
                    {re.floors !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Number of Floors</div>
                        <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                          {re.floors}
                        </div>
                      </div>
                    )}
                    {re.floorNumber !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Floor Level</div>
                        <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                          Floor {re.floorNumber} of {re.totalFloors || 4}
                        </div>
                      </div>
                    )}
                    {re.constructionStatus && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Construction Status</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.constructionStatus}
                        </div>
                      </div>
                    )}
                    {re.furnishingStatus && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Furnishing</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.furnishingStatus}
                        </div>
                      </div>
                    )}
                    {re.parking && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Parking</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.parking}
                        </div>
                      </div>
                    )}
                    {re.liftAvailable !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Lift / Elevator</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.liftAvailable ? 'Available' : 'Walk-up'}
                        </div>
                      </div>
                    )}
                    {re.maintenanceMonthly !== undefined && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Monthly Maintenance</div>
                        <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                          ₹{re.maintenanceMonthly.toLocaleString('en-IN')}/mo
                        </div>
                      </div>
                    )}
                    {re.commercialUse && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Commercial Use</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.commercialUse}
                        </div>
                      </div>
                    )}
                    {re.powerWaterAvailability && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Power &amp; Water</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.powerWaterAvailability}
                        </div>
                      </div>
                    )}
                    {re.roomType && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Room / PG Type</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.roomType} (Capacity: {re.occupancyCapacity || 1})
                        </div>
                      </div>
                    )}
                    {re.paymentFrequency && (
                      <div>
                        <div className="text-[var(--ps-text-muted)]">Payment Frequency</div>
                        <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                          {re.paymentFrequency}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Utilities & Amenities */}
                <div className="pt-3 border-t border-[var(--ps-border)] grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="font-semibold text-[var(--ps-text)] mb-1">
                      Utilities
                    </div>
                    <div className="text-[var(--ps-text-muted)]">
                      {re.utilities.join(' · ')}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-[var(--ps-text)] mb-1">
                      Amenities &amp; Features
                    </div>
                    <div className="text-[var(--ps-text-muted)]">
                      {re.amenities.join(' · ')}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Second Property-Specific Interactive Map for Real Estate */}
            {listing.category === 'real_estate' && re && (
              <PropertyBoundaryMap
                listingId={listing.id}
                propertyTitle={listing.title}
                propertyType={re.propertyType}
                hasAssociatedPlot={re.hasAssociatedPlot}
                coordinates={listing.coordinates}
                boundaryPolygon={re.boundaryPolygon}
                plotAreaSqm={re.plotAreaSqm}
                apiKeyAvailable={apiKeyAvailable}
                canEditGeometry={
                  currentUser.roleType === 'owner' ||
                  currentUser.roleType === 'admin'
                }
                onUpdatePolygon={(newPoly, newAreaSqm) => {
                  saveListing({
                    ...listing,
                    realEstateDetails: {
                      ...re,
                      boundaryPolygon: newPoly,
                      plotAreaSqm: newAreaSqm,
                    },
                  });
                }}
              />
            )}

            {/* ============================================================== */}
            {/* CATEGORY B: BUSINESS & SHOP DETAILS + PRODUCT CATALOGUE         */}
            {/* (Strictly NO 360° panorama requirement or viewer)               */}
            {/* ============================================================== */}
            {listing.category === 'business' && listing.businessDetails && (
              <>
                <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-4">
                  <h3 className="text-base font-semibold text-[var(--ps-text)]">
                    Business Information
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-[var(--ps-text-muted)]">Opening Hours</div>
                      <div className="font-semibold text-[var(--ps-text)] mt-0.5 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{listing.businessDetails.openingHours}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--ps-text-muted)]">Price Tier</div>
                      <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                        {listing.businessDetails.priceRange} (Sample Guide)
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--ps-text-muted)]">Service Mode</div>
                      <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                        {listing.businessDetails.deliveryInfo}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Business Product Catalogue */}
                <section
                  aria-label="Business Product Catalogue"
                  className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[var(--ps-border)] pb-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--ps-text)]">
                        Product Catalogue ({filteredCatalogue.length} sample items)
                      </h3>
                      <p className="text-xs text-[var(--ps-text-muted)]">
                        Browse synthetic catalogue products. Commercial checkout and ordering are disabled in this prototype.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="search"
                          value={catalogueQuery}
                          onChange={(e) => setCatalogueQuery(e.target.value)}
                          placeholder="Search catalogue..."
                          aria-label="Search business catalogue"
                          className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                        />
                      </div>
                      <select
                        aria-label="Filter catalogue by category"
                        value={catalogueCategory}
                        onChange={(e) => setCatalogueCategory(e.target.value)}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                      >
                        <option value="all">All Categories</option>
                        {catalogueCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {filteredCatalogue.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--ps-text-muted)]">
                      No catalogue products match your current filter.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {filteredCatalogue.map((prod) => (
                        <div
                          key={prod.id}
                          className="border border-[var(--ps-border)] rounded-xl overflow-hidden bg-[var(--ps-bg)] flex flex-col"
                        >
                          <div className="h-36 bg-slate-900 relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={prod.imageUrl}
                              alt={prod.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            {prod.promotionLabel && (
                              <span className="absolute top-2 left-2 bg-slate-950/85 text-amber-300 text-[10px] font-semibold px-2 py-0.5 rounded">
                                {prod.promotionLabel}
                              </span>
                            )}
                          </div>
                          <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                            <div>
                              <div className="text-[11px] text-[var(--ps-text-muted)]">
                                {prod.category} ·{' '}
                                {prod.availability.replace(/_/g, ' ')}
                              </div>
                              <h4 className="text-sm font-semibold text-[var(--ps-text)] mt-0.5">
                                {prod.name}
                              </h4>
                              <p className="text-xs text-[var(--ps-text-muted)] mt-1">
                                {prod.description}
                              </p>
                            </div>
                            <div className="pt-2 border-t border-[var(--ps-border)] flex items-center justify-between text-xs">
                              <span className="font-bold text-[var(--ps-text)] tabular-nums">
                                ₹{prod.price.toLocaleString('en-IN')}{' '}
                                <span className="font-normal text-[10px] text-[var(--ps-text-muted)]">
                                  (Sample)
                                </span>
                              </span>
                              <span className="text-[11px] text-[var(--ps-text-muted)]">
                                Variants: {prod.variants.join(', ')}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ============================================================== */}
            {/* CATEGORY C: SERVICES & PROVIDERS DETAILS                        */}
            {/* ============================================================== */}
            {listing.category === 'service' && listing.serviceDetails && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-[var(--ps-text)]">
                  Service Provider Details
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Service Category</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.serviceDetails.serviceType}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Availability Status</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.serviceDetails.availabilityStatus}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Sample Rate Range</div>
                    <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                      {listing.serviceDetails.priceRangeText}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Working Hours</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.serviceDetails.workingHours}
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t border-[var(--ps-border)] text-xs space-y-2">
                  <div>
                    <span className="font-semibold text-[var(--ps-text)]">
                      Localities Served:{' '}
                    </span>
                    <span className="text-[var(--ps-text-muted)]">
                      {listing.serviceDetails.areasServed.join(' · ')}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-[var(--ps-text)]">
                      Work Samples:{' '}
                    </span>
                    <span className="text-[var(--ps-text-muted)]">
                      {listing.serviceDetails.workSamples.join(' · ')}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* ============================================================== */}
            {/* CATEGORY D: SPORTS & RECREATIONAL VENUES DETAILS                */}
            {/* ============================================================== */}
            {listing.category === 'sports' && listing.sportsDetails && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-[var(--ps-text)]">
                  Sports &amp; Recreational Venue Specifications
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Sport / Activity</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.sportsDetails.sportActivity}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Venue Type</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.sportsDetails.venueCategory}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Sample Capacity</div>
                    <div className="font-semibold text-[var(--ps-text)] tabular-nums mt-0.5">
                      {listing.sportsDetails.capacity} people
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Surface Type</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.sportsDetails.surfaceType}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Opening Hours</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.sportsDetails.openingHours}
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t border-[var(--ps-border)] text-xs">
                  <span className="font-semibold text-[var(--ps-text)]">
                    Venue Facilities:{' '}
                  </span>
                  <span className="text-[var(--ps-text-muted)]">
                    {listing.sportsDetails.facilities.join(' · ')}
                  </span>
                </div>
              </section>
            )}

            {/* ============================================================== */}
            {/* CATEGORY E: PUBLIC-INTEREST & COMMUNITY PLACES                  */}
            {/* ============================================================== */}
            {listing.category === 'public_place' && listing.publicPlaceDetails && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-[var(--ps-text)]">
                  Public-Interest &amp; Community Facility Details
                </h3>
                <p className="text-xs text-[var(--ps-text)] leading-relaxed">
                  {listing.publicPlaceDetails.publicInfo}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Opening Schedule</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.publicPlaceDetails.openingHours}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--ps-text-muted)]">Accessibility</div>
                    <div className="font-semibold text-[var(--ps-text)] mt-0.5">
                      {listing.publicPlaceDetails.accessibilityNotes}
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t border-[var(--ps-border)] text-xs space-y-1">
                  <div>
                    <span className="font-semibold text-[var(--ps-text)]">
                      Public Facilities:{' '}
                    </span>
                    <span className="text-[var(--ps-text-muted)]">
                      {listing.publicPlaceDetails.facilities.join(' · ')}
                    </span>
                  </div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                    Source Label: {listing.publicPlaceDetails.verificationSourceLabel}
                  </div>
                </div>
              </section>
            )}

            {/* Dynamic Custom Fields (configured by Admin) */}
            {categoryCustomFields.length > 0 && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-[var(--ps-text)]">
                  Additional Category Attributes
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {categoryCustomFields.map((df) => (
                    <div key={df.id}>
                      <div className="text-[var(--ps-text-muted)]">{df.label}</div>
                      <div className="font-medium text-[var(--ps-text)]">
                        {listing.customFields?.[df.name] !== undefined
                          ? String(listing.customFields[df.name])
                          : 'Sample Default (Configured)'}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Photo Gallery */}
            {listing.galleryImages.length > 0 && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-3">
                <h3 className="text-base font-semibold text-[var(--ps-text)]">
                  Sample Photo Gallery
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {listing.galleryImages.map((img, i) => (
                    <div
                      key={i}
                      className="h-44 rounded-lg overflow-hidden border border-[var(--ps-border)] bg-slate-900"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img}
                        alt={`${listing.title} gallery ${i + 1}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Sample Reviews & Owner Replies */}
            <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--ps-text)]">
                  Sample Reviews &amp; Owner Responses ({listingReviews.length})
                </h3>
                <span className="text-xs text-[var(--ps-text-muted)]">
                  Synthetic Demonstration Feedback
                </span>
              </div>

              {listingReviews.length === 0 ? (
                <p className="text-xs text-[var(--ps-text-muted)]">
                  No sample reviews recorded for this listing yet.
                </p>
              ) : (
                <div className="divide-y divide-[var(--ps-border)] space-y-4">
                  {listingReviews.map((rev) => (
                    <div key={rev.id} className="pt-4 first:pt-0 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="font-semibold text-[var(--ps-text)]">
                          {rev.authorName}{' '}
                          <span className="font-normal text-[var(--ps-text-muted)]">
                            · {rev.createdAt}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-600 dark:text-amber-400 font-semibold tabular-nums">
                            {'★'.repeat(rev.rating)} ({rev.rating}/5)
                          </span>
                          {!rev.reported && (
                            <button
                              type="button"
                              onClick={() =>
                                reportReview(
                                  rev.id,
                                  'Flagged by visitor for moderator check'
                                )
                              }
                              aria-label={`Report review by ${rev.authorName}`}
                              className="text-[11px] text-[var(--ps-text-muted)] hover:text-red-600 inline-flex items-center gap-1"
                            >
                              <Flag className="w-3 h-3" />
                              <span>Report</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[var(--ps-text)] leading-relaxed">
                        {rev.comment}
                      </p>
                      {rev.ownerReply && (
                        <div className="mt-2 p-3 rounded-lg bg-[var(--ps-surface-alt)] text-xs space-y-1">
                          <div className="font-semibold text-[var(--ps-text)]">
                            Listing Owner Response{' '}
                            {rev.ownerReplyUpdatedAt && (
                              <span className="font-normal text-[var(--ps-text-muted)]">
                                · {rev.ownerReplyUpdatedAt}
                              </span>
                            )}
                          </div>
                          <p className="text-[var(--ps-text-muted)]">
                            {rev.ownerReply}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add Sample Review Form */}
              {platformSettings.enablePublicReviews && (
                <form
                  onSubmit={handleReviewSubmit}
                  className="pt-4 border-t border-[var(--ps-border)] space-y-3"
                >
                  <h4 className="text-xs font-semibold text-[var(--ps-text)]">
                    Post a Demonstration Review (Local Prototype Only)
                  </h4>
                  {revSubmitted && (
                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs">
                      Sample review saved! It is now visible on this page and in the Owner Workspace.
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--ps-text-muted)] mb-1">
                        Your Sample Name
                      </label>
                      <input
                        type="text"
                        required
                        value={revName}
                        onChange={(e) => setRevName(e.target.value)}
                        placeholder="e.g. Demo Explorer"
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--ps-text-muted)] mb-1">
                        Star Rating
                      </label>
                      <select
                        value={revRating}
                        onChange={(e) => setRevRating(Number(e.target.value))}
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                      >
                        <option value={5}>5 Stars — Excellent</option>
                        <option value={4}>4 Stars — Good</option>
                        <option value={3}>3 Stars — Average</option>
                        <option value={2}>2 Stars — Below Average</option>
                        <option value={1}>1 Star — Poor</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ps-text-muted)] mb-1">
                      Review Comment
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={revComment}
                      onChange={(e) => setRevComment(e.target.value)}
                      placeholder="Write synthetic feedback for testing..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-medium hover:opacity-90"
                  >
                    Submit Sample Review
                  </button>
                </form>
              )}
            </section>
          </div>

          {/* Right Column: Synthetic Contact & Demonstration Enquiry Form */}
          <div className="space-y-6">
            <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--ps-text)]">
                Synthetic Contact Details
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[var(--ps-text)]">
                  <Phone className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                  <span className="font-mono tabular-nums">
                    {listing.contactPhone} (Sample)
                  </span>
                </div>
                <div className="text-[var(--ps-text-muted)] break-all">
                  Email: {listing.contactEmail}
                </div>
                <div className="text-[var(--ps-text-muted)]">
                  Managed by: {listing.ownerName}
                </div>
              </div>
            </section>

            {platformSettings.enablePublicEnquiries && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[var(--ps-text)]" />
                  <h3 className="text-sm font-semibold text-[var(--ps-text)]">
                    Send Demonstration Enquiry
                  </h3>
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Routes directly to the Owner &amp; Staff Enquiry Centre in this prototype. No external emails or SMS are sent.
                </p>

                {enqSubmitted && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs">
                    Demonstration enquiry recorded! Switch to the Listing Owner workspace to view and reply.
                  </div>
                )}

                <form onSubmit={handleEnquirySubmit} className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-[var(--ps-text-muted)] mb-1">
                      Your Name (Sample)
                    </label>
                    <input
                      type="text"
                      required
                      value={enqName}
                      onChange={(e) => setEnqName(e.target.value)}
                      placeholder="Sample Visitor Name"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ps-text-muted)] mb-1">
                      Sample Phone (Optional)
                    </label>
                    <input
                      type="text"
                      value={enqPhone}
                      onChange={(e) => setEnqPhone(e.target.value)}
                      placeholder="+91 90000 00000"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--ps-text-muted)] mb-1">
                      Enquiry Message
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={enqMessage}
                      onChange={(e) => setEnqMessage(e.target.value)}
                      placeholder="Ask a question about this sample listing..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 px-4 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-90"
                  >
                    Submit Demo Enquiry
                  </button>
                </form>
              </section>
            )}

            {/* Related Sample Listings */}
            {relatedListings.length > 0 && onSelectRelatedListing && (
              <section className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-[var(--ps-text)]">
                  Related Sample Listings
                </h3>
                <div className="space-y-2.5">
                  {relatedListings.map((rel) => (
                    <button
                      key={rel.id}
                      type="button"
                      onClick={() => onSelectRelatedListing(rel.id)}
                      className="w-full text-left p-2.5 rounded-lg border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="text-xs font-semibold text-[var(--ps-text)] truncate">
                        {rel.title}
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-muted)] truncate mt-0.5">
                        {rel.subcategory} · {rel.locality}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CategoryDetailView;

