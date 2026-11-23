'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  Printer,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import {
  LocalityCombobox,
  type LocalitySelection,
} from '@/components/ui/LocalityCombobox';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isUuid } from '@/lib/payments/types';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { calculateListingCompleteness } from '@/lib/rules';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type {
  LatLngPoint,
  Listing,
  ListingStatus,
  PropertyType,
} from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';
import { StaffDelegationManager } from '../StaffDelegationManager';
import {
  ListingMediaEditor,
  revokeMediaDraftPreviews,
  uploadStagedListingMedia,
  type ListingMediaDraft,
} from './ListingMediaEditor';
import { ListingVerticalFieldsSection } from './ListingVerticalFieldsSection';
import {
  buildVerticalSummary,
  createInitialVerticalBundle,
  hydrateVerticalProfileFromSupabase,
  saveVerticalProfileToSupabase,
  VERTICAL_OPTIONS,
  verticalToLegacyCategory,
  type VerticalFormBundle,
} from './listingVerticalProfiles';
import { MapCoordinatePicker } from './MapCoordinatePicker';

export interface ListingEditorModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialListing?: Listing | null;
  defaultHubId?: string | null;
  defaultVertical?: ListingVertical;
  isStaffMode?: boolean;
  onClose: () => void;
  onSaved?: (
    savedListingId: string,
    savedStatus: ListingStatus
  ) => void | Promise<void>;
}

type EditorStepId = 'core' | 'vertical' | 'media_hours' | 'staff_preview';

const HOURS_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Mon–Sat 9 AM – 6 PM', value: 'Mon–Sat: 9:00 AM – 6:00 PM' },
  { label: 'Daily 8 AM – 9 PM', value: 'Daily: 8:00 AM – 9:00 PM' },
  { label: '24×7 Open', value: 'Open 24 Hours (24×7)' },
  { label: 'Mon–Fri Office Hours', value: 'Mon–Fri: 9:30 AM – 5:00 PM' },
];

const STEP_ITEMS: Array<{ id: EditorStepId; label: string }> = [
  { id: 'core', label: '1. Core & Location' },
  { id: 'vertical', label: '2. Vertical Setup' },
  { id: 'media_hours', label: '3. Media & Hours' },
  { id: 'staff_preview', label: '4. Staff & Submit' },
];

const emptySubscribe = () => () => {};

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]';
const LABEL_CLASS =
  'block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1';

function extractExistingLogoUrl(listing?: Listing | null): string | null {
  if (!listing) return null;
  const rec = listing as unknown as Record<string, unknown>;
  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
  const candidate =
    rec.logo_url ||
    rec.logoUrl ||
    summary.logo_url ||
    summary.brand_logo_url ||
    null;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

export function ListingEditorModal({
  isOpen,
  mode,
  initialListing,
  defaultHubId,
  defaultVertical = 'general',
  isStaffMode = false,
  onClose,
  onSaved,
}: ListingEditorModalProps) {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const { user, session, role: authRole, fullName: authFullName } = useAuth();
  const { setStatus } = useAppStatus();
  const { hubs, activeHub, hubLocalities } = useAppConfig();

  const userRoleLower = String(authRole || user?.user_metadata?.role || '').toLowerCase();
  const isSuperAdmin =
    userRoleLower === 'super_admin' || userRoleLower === 'admin';
  const isHubManager = userRoleLower === 'hub_manager';
  const isPrivilegedOfficialRole = isSuperAdmin || isHubManager;
  const resolvedActorName =
    authFullName ||
    String(user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Business Partner');

  const existingListingId =
    mode === 'edit' && initialListing?.id && isUuid(initialListing.id)
      ? initialListing.id
      : null;
  const entitlementOwnerId = initialListing?.ownerId || user?.id || null;
  const { limit, can } = useEffectiveEntitlements(
    entitlementOwnerId,
    existingListingId
  );
  const maxMediaQuota = limit('max_media_per_listing');

  const [activeStep, setActiveStep] = useState<EditorStepId>('core');
  const [vertical, setVertical] = useState<ListingVertical>(
    initialListing?.listing_vertical || defaultVertical
  );
  const [title, setTitle] = useState(initialListing?.title || '');
  const [subcategory, setSubcategory] = useState(
    initialListing?.subcategory || 'General'
  );
  const [shortDescription, setShortDescription] = useState(
    initialListing?.shortDescription || ''
  );
  const [description, setDescription] = useState(
    initialListing?.description || ''
  );
  const [contactPhone, setContactPhone] = useState(
    initialListing?.contactPhone || ''
  );
  const [whatsapp, setWhatsapp] = useState(initialListing?.whatsapp || '');
  const [contactEmail, setContactEmail] = useState(
    initialListing?.contactEmail || ''
  );
  const [hubId, setHubId] = useState<string>(
    initialListing?.hub_id || defaultHubId || activeHub?.id || ''
  );
  const [localityId, setLocalityId] = useState<string | null>(
    initialListing?.locality_id ?? null
  );
  const [localityName, setLocalityName] = useState<string>(
    initialListing?.locality || ''
  );
  const [localityCoords, setLocalityCoords] = useState<LatLngPoint | null>(null);
  const [address, setAddress] = useState(initialListing?.address || '');
  const [tagsText, setTagsText] = useState(
    (initialListing?.custom_tags || []).join(', ')
  );
  const [coordinates, setCoordinates] = useState<LatLngPoint>(
    initialListing?.coordinates || {
      lat: activeHub?.center_lat || 24.3335,
      lng: activeHub?.center_lng || 93.6978,
    }
  );
  const [openingHours, setOpeningHours] = useState(
    initialListing?.opening_hours ||
      initialListing?.businessDetails?.openingHours ||
      initialListing?.serviceDetails?.workingHours ||
      initialListing?.sportsDetails?.openingHours ||
      initialListing?.publicPlaceDetails?.openingHours ||
      'Mon–Sat: 9:00 AM – 6:00 PM'
  );

  const [bundle, setBundle] = useState<VerticalFormBundle>(() =>
    createInitialVerticalBundle(initialListing)
  );
  const [mediaDraft, setMediaDraft] = useState<ListingMediaDraft>({
    logo: null,
    cover: null,
    gallery: [],
    panorama: null,
  });

  const [isHydratingVertical, setIsHydratingVertical] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    targetStatus: ListingStatus;
    title: string;
    description: string;
    confirmLabel: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize state cleanly whenever modal opens or target listing changes
  useEffect(() => {
    if (!isOpen) return;

    setActiveStep('core');
    setErrorBanner(null);
    setConfirmAction(null);

    const initVertical =
      initialListing?.listing_vertical || defaultVertical || 'general';
    const selectedHubObj =
      hubs.find(
        (h) => h.id === (initialListing?.hub_id || defaultHubId || activeHub?.id)
      ) || activeHub;

    setVertical(initVertical);
    setTitle(initialListing?.title || '');
    setSubcategory(initialListing?.subcategory || 'General');
    setShortDescription(initialListing?.shortDescription || '');
    setDescription(initialListing?.description || '');
    setContactPhone(initialListing?.contactPhone || '');
    setWhatsapp(initialListing?.whatsapp || '');
    setContactEmail(initialListing?.contactEmail || '');
    setHubId(
      initialListing?.hub_id || defaultHubId || selectedHubObj?.id || ''
    );
    setLocalityId(initialListing?.locality_id ?? null);
    setLocalityName(initialListing?.locality || '');
    setLocalityCoords(null);
    setAddress(initialListing?.address || '');
    setTagsText((initialListing?.custom_tags || []).join(', '));
    setCoordinates(
      initialListing?.coordinates || {
        lat: selectedHubObj?.center_lat || 24.3335,
        lng: selectedHubObj?.center_lng || 93.6978,
      }
    );
    setOpeningHours(
      initialListing?.opening_hours ||
        initialListing?.businessDetails?.openingHours ||
        initialListing?.serviceDetails?.workingHours ||
        initialListing?.sportsDetails?.openingHours ||
        initialListing?.publicPlaceDetails?.openingHours ||
        'Mon–Sat: 9:00 AM – 6:00 PM'
    );

    const existingLogo = extractExistingLogoUrl(initialListing);
    const existingCover = initialListing?.coverImage || null;
    const existingPano =
      initialListing?.realEstateDetails?.panoramaUrl ||
      initialListing?.realEstateDetails?.panoramas?.[0]?.imageUrl ||
      null;

    setMediaDraft((prev) => {
      revokeMediaDraftPreviews(prev);
      return {
        logo: existingLogo
          ? { previewUrl: existingLogo, isStagedNew: false }
          : null,
        cover: existingCover
          ? { previewUrl: existingCover, isStagedNew: false }
          : null,
        gallery: (initialListing?.galleryImages || [])
          .filter(Boolean)
          .map((url) => ({ previewUrl: url, isStagedNew: false })),
        panorama: existingPano
          ? { previewUrl: existingPano, isStagedNew: false }
          : null,
      };
    });

    const baseBundle = createInitialVerticalBundle(initialListing);
    setBundle(baseBundle);

    if (
      mode === 'edit' &&
      initialListing?.id &&
      isUuid(initialListing.id) &&
      isSupabaseConfigured()
    ) {
      setIsHydratingVertical(true);
      void hydrateVerticalProfileFromSupabase(
        supabase,
        initialListing.id,
        initVertical,
        baseBundle
      )
        .then((hydrated) => {
          setBundle(hydrated);
        })
        .finally(() => {
          setIsHydratingVertical(false);
        });
    }
  }, [isOpen, mode, initialListing, defaultHubId, defaultVertical, hubs, activeHub]);

  // Clean up un-uploaded memory blobs on unmount
  useEffect(() => {
    return () => {
      revokeMediaDraftPreviews(mediaDraft);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedHubObj = useMemo(
    () => hubs.find((h) => h.id === hubId) || activeHub || null,
    [hubs, hubId, activeHub]
  );

  const hubCenter = useMemo<LatLngPoint | null>(() => {
    if (!selectedHubObj) return null;
    return {
      lat: selectedHubObj.center_lat,
      lng: selectedHubObj.center_lng,
    };
  }, [selectedHubObj]);

  const legacyCategory = useMemo(
    () => verticalToLegacyCategory(vertical),
    [vertical]
  );

  const mappedUiPropertyType: PropertyType = useMemo(() => {
    const pt = bundle.realEstate.propertyType;
    if (pt === 'house') return 'house_with_plot';
    if (pt === 'apartment') return 'apartment';
    if (pt === 'commercial_shop') return 'commercial';
    if (pt === 'room_pg') return 'room_pg';
    return 'plot_land';
  }, [bundle.realEstate.propertyType]);

  // Live completeness report synthesized from current editor form state
  const liveCompleteness = useMemo(() => {
    const mappedAvailability: Listing['realEstateDetails'] extends infer R
      ? R extends { availability: infer A }
        ? A
        : 'available'
      : 'available' =
      bundle.realEstate.availabilityStatus === 'sold_rented'
        ? bundle.realEstate.dealType === 'rent'
          ? 'rented'
          : 'sold'
        : bundle.realEstate.availabilityStatus === 'under_offer'
        ? 'under_negotiation'
        : bundle.realEstate.availabilityStatus === 'paused'
        ? 'withdrawn'
        : 'available';

    const mockListing: Listing = {
      id: existingListingId || 'draft',
      hub_id: hubId || null,
      locality_id: localityId,
      listing_vertical: vertical,
      title: title.trim(),
      category: legacyCategory,
      subcategory: subcategory.trim() || 'General',
      shortDescription: shortDescription.trim(),
      description: description.trim(),
      locality: localityName.trim(),
      address: address.trim(),
      coordinates,
      status: 'draft',
      verificationStatus: 'unverified_sample',
      ownerId: entitlementOwnerId || '',
      ownerName: resolvedActorName || 'Owner',
      assignedStaffIds: [],
      contactPhone: contactPhone.trim(),
      contactEmail: contactEmail.trim(),
      coverImage: mediaDraft.cover?.previewUrl || '',
      galleryImages: mediaDraft.gallery.map((g) => g.previewUrl),
      rating: 5,
      reviewCount: 0,
      viewsCount: 0,
      mapImpressionsCount: 0,
      detailVisitsCount: 0,
      followsCount: 0,
      enquiriesCount: 0,
      directionClicksCount: 0,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      versionHistory: [],
      businessDetails:
        legacyCategory === 'business'
          ? {
              subcategory,
              openingHours,
              priceRange: bundle.general.priceRange,
              deliveryInfo: bundle.general.deliveryInfo,
              establishedYear: 2024,
              highlights: [],
              catalogue: [{ id: '1', listingId: 'draft', name: 'Sample', category: subcategory, description: '', price: 0, variants: [], availability: 'in_stock', imageUrl: '' }],
            }
          : undefined,
      serviceDetails:
        legacyCategory === 'service'
          ? {
              serviceType: subcategory,
              areasServed: bundle.general.serviceAreasText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              workingHours: openingHours,
              availabilityStatus: 'Available Today',
              startingPrice: bundle.general.startingPriceInr,
              priceRangeText: '',
              experienceYears: bundle.general.experienceYears,
              workSamples: [],
              certificationsLabel: '',
            }
          : undefined,
      realEstateDetails:
        legacyCategory === 'real_estate'
          ? {
              propertyType: mappedUiPropertyType,
              hasAssociatedPlot: bundle.realEstate.propertyType === 'plot_land',
              availability: mappedAvailability,
              askingPrice: bundle.realEstate.priceInr,
              priceLabel: formatIndianPropertyPrice(
                bundle.realEstate.priceInr,
                bundle.realEstate.pricePeriod
              ),
              plotAreaSqm: bundle.realEstate.plotAreaSqm,
              boundaryPolygon: bundle.realEstate.boundaryPolygon,
              utilities: [],
              amenities: [],
              panoramas: [],
              streetViewAvailable: false,
            }
          : undefined,
    };
    return calculateListingCompleteness(mockListing);
  }, [
    existingListingId,
    hubId,
    localityId,
    vertical,
    title,
    legacyCategory,
    subcategory,
    shortDescription,
    description,
    localityName,
    address,
    coordinates,
    entitlementOwnerId,
    resolvedActorName,
    contactPhone,
    contactEmail,
    mediaDraft.cover?.previewUrl,
    mediaDraft.gallery,
    openingHours,
    bundle,
    mappedUiPropertyType,
  ]);

  const jumpToMissingSection = (section: string) => {
    if (section === 'core' || section === 'location') setActiveStep('core');
    else if (section === 'category') setActiveStep('vertical');
    else if (section === 'media' || section === 'catalogue')
      setActiveStep('media_hours');
    else setActiveStep('core');
  };

  const handleCloseSafely = useCallback(() => {
    if (isSubmitting) return;
    revokeMediaDraftPreviews(mediaDraft);
    onClose();
  }, [isSubmitting, mediaDraft, onClose]);

  const validateBeforeConfirm = (targetStatus: ListingStatus): string | null => {
    if (!title.trim() || title.trim().length < 3) {
      return 'Please enter a valid listing title (minimum 3 characters).';
    }
    if (!hubId) {
      return 'Please select a Service Hub.';
    }
    if (!localityName.trim()) {
      return 'Please select or enter a Locality name.';
    }
    if (targetStatus !== 'draft' && !contactPhone.trim()) {
      return 'A contact phone number is required before submitting for review.';
    }
    if (vertical === 'public_civic' && !isPrivilegedOfficialRole) {
      return 'Only Hub Managers or Super-Admins can create or edit Public Civic records.';
    }
    return null;
  };

  const requestConfirmSave = (targetStatus: ListingStatus) => {
    const err = validateBeforeConfirm(targetStatus);
    if (err) {
      setErrorBanner(err);
      setActiveStep('core');
      return;
    }
    setErrorBanner(null);

    if (targetStatus === 'published') {
      setConfirmAction({
        targetStatus,
        title: 'Save & Publish Listing Live?',
        description:
          'This will upload any staged photos permanently, update all vertical tables, and immediately publish the listing to Explore.',
        confirmLabel: 'Publish Now',
      });
    } else if (targetStatus === 'pending_verification') {
      setConfirmAction({
        targetStatus,
        title: 'Submit Listing for Verification?',
        description:
          'Staged images will be uploaded under temporary 14-day pending-verification storage until a Hub Manager or Admin approves them.',
        confirmLabel: 'Confirm & Submit',
      });
    } else {
      setConfirmAction({
        targetStatus: 'draft',
        title: 'Save Listing as Draft?',
        description:
          'Draft listings remain hidden from public discovery. Staged media is held temporarily (14 days) until approved.',
        confirmLabel: 'Save Draft',
      });
    }
  };

  const executeSaveConfirmed = async () => {
    if (!confirmAction || isSubmitting) return;
    if (!isSupabaseConfigured()) {
      setErrorBanner('Supabase is not configured in this environment.');
      return;
    }

    const desiredStatus = confirmAction.targetStatus;
    setIsSubmitting(true);
    setStatus('saving');
    setErrorBanner(null);

    try {
      const effectiveOwnerId =
        initialListing?.ownerId && isUuid(initialListing.ownerId)
          ? initialListing.ownerId
          : user?.id || null;

      if (!effectiveOwnerId) {
        throw new Error('You must be signed in to save a listing.');
      }

      const cleanTags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const resolvedRealEstateJson =
        vertical === 'real_estate'
          ? {
              ...(initialListing?.realEstateDetails || {}),
              propertyType: mappedUiPropertyType,
              hasAssociatedPlot: bundle.realEstate.propertyType === 'plot_land',
              availability:
                bundle.realEstate.availabilityStatus === 'sold_rented'
                  ? bundle.realEstate.dealType === 'rent'
                    ? ('rented' as const)
                    : ('sold' as const)
                  : bundle.realEstate.availabilityStatus === 'under_offer'
                  ? ('under_negotiation' as const)
                  : bundle.realEstate.availabilityStatus === 'paused'
                  ? ('withdrawn' as const)
                  : ('available' as const),
              askingPrice: bundle.realEstate.priceInr,
              priceLabel: formatIndianPropertyPrice(
                bundle.realEstate.priceInr,
                bundle.realEstate.pricePeriod
              ),
              plotAreaSqm: bundle.realEstate.plotAreaSqm,
              dimensionsText: bundle.realEstate.landAreaText,
              bedrooms: bundle.realEstate.bedrooms,
              bathrooms: bundle.realEstate.bathrooms,
              furnishingStatus:
                bundle.realEstate.furnishing === 'furnished'
                  ? ('Fully Furnished' as const)
                  : bundle.realEstate.furnishing === 'semi_furnished'
                  ? ('Semi-Furnished' as const)
                  : ('Unfurnished' as const),
              parking: bundle.realEstate.parkingAvailable ? 'Yes' : 'No',
              boundaryPolygon: bundle.realEstate.boundaryPolygon,
              panoramaUrl:
                mediaDraft.panorama?.previewUrl ||
                initialListing?.realEstateDetails?.panoramaUrl ||
                '',
              utilities: initialListing?.realEstateDetails?.utilities || [],
              amenities: initialListing?.realEstateDetails?.amenities || [],
              panoramas: initialListing?.realEstateDetails?.panoramas || [],
              streetViewAvailable: false,
            }
          : initialListing?.realEstateDetails ?? null;

      const resolvedBusinessJson =
        legacyCategory === 'business'
          ? {
              ...(initialListing?.businessDetails || {}),
              subcategory: subcategory.trim() || 'General',
              openingHours: openingHours.trim(),
              priceRange: bundle.general.priceRange,
              deliveryInfo: bundle.general.deliveryInfo.trim(),
              establishedYear:
                initialListing?.businessDetails?.establishedYear || 2024,
              highlights: bundle.general.highlightsText
                .split(',')
                .map((h) => h.trim())
                .filter(Boolean),
              catalogue: initialListing?.businessDetails?.catalogue || [],
            }
          : initialListing?.businessDetails ?? null;

      // STEP A: Obtain genuine PostgreSQL UUID first if creating
      let targetListingId = existingListingId;
      if (!targetListingId) {
        const { data: insertedRow, error: insertErr } = await supabase
          .from('listings')
          .insert({
            owner_id: effectiveOwnerId,
            owner_name: resolvedActorName,
            hub_id: hubId,
            category_id: initialListing?.category_id ?? null,
            locality_id: localityId,
            custom_tags: cleanTags,
            listing_vertical: vertical,
            is_civic_record: vertical === 'public_civic',
            lifecycle_status: 'active',
            title: title.trim(),
            category: legacyCategory,
            subcategory: subcategory.trim() || 'General',
            status:
              desiredStatus === 'published' && isPrivilegedOfficialRole
                ? 'pending_verification'
                : desiredStatus,
            short_description: shortDescription.trim(),
            description: description.trim(),
            locality: localityName.trim(),
            address: address.trim(),
            contact_phone: contactPhone.trim(),
            whatsapp: whatsapp.trim() || null,
            contact_email: contactEmail.trim() || null,
            opening_hours: openingHours.trim() || null,
            lat: coordinates.lat,
            lng: coordinates.lng,
            coordinates,
            business_details: resolvedBusinessJson,
            real_estate_details: resolvedRealEstateJson,
          })
          .select('id')
          .single();

        if (insertErr || !insertedRow?.id) {
          throw new Error(insertErr?.message || 'Failed to create listing row.');
        }
        targetListingId = String(insertedRow.id);
      }

      // STEP B: Upload ONLY newly staged media blobs (held ephemeral 14d pending verification)
      const uploadResult = await uploadStagedListingMedia({
        draft: mediaDraft,
        listingId: targetListingId,
        hubId,
        accessToken: session?.access_token,
        retentionClass: 'ephemeral_ttl',
        mediaStatus: 'pending_verification',
        ttlDays: 14,
      });

      if (uploadResult.errors.length > 0) {
        throw new Error(uploadResult.errors[0]);
      }

      const finalLogoUrl = uploadResult.logoUrl || null;
      const finalCoverUrl = uploadResult.coverImage || '';
      const finalGalleryUrls = uploadResult.galleryImages;
      const finalPanoramaUrl = uploadResult.panoramaUrl || '';

      const nextRealEstateWithPano =
        resolvedRealEstateJson && finalPanoramaUrl
          ? {
              ...resolvedRealEstateJson,
              panoramaUrl: finalPanoramaUrl,
              panoramas: [
                {
                  id: `pano-${Date.now()}`,
                  label: 'Primary 360° Tour',
                  imageUrl: finalPanoramaUrl,
                  width: 2048,
                  height: 1024,
                  sceneType: 'interior' as const,
                },
              ],
            }
          : resolvedRealEstateJson;

      const summary = buildVerticalSummary(
        vertical,
        bundle,
        finalLogoUrl,
        contactPhone.trim()
      );

      // STEP C: Update listings core record with resolved media URLs + vertical summary
      const { error: updateErr } = await supabase
        .from('listings')
        .update({
          hub_id: hubId,
          locality_id: localityId,
          custom_tags: cleanTags,
          listing_vertical: vertical,
          is_civic_record: vertical === 'public_civic',
          vertical_summary: summary,
          title: title.trim(),
          category: legacyCategory,
          subcategory: subcategory.trim() || 'General',
          status:
            desiredStatus === 'published' && isPrivilegedOfficialRole
              ? 'pending_verification'
              : desiredStatus,
          short_description: shortDescription.trim(),
          description: description.trim(),
          locality: localityName.trim(),
          address: address.trim(),
          contact_phone: contactPhone.trim(),
          whatsapp: whatsapp.trim() || null,
          contact_email: contactEmail.trim() || null,
          opening_hours: openingHours.trim() || null,
          lat: coordinates.lat,
          lng: coordinates.lng,
          coordinates,
          logo_url: finalLogoUrl,
          cover_image: finalCoverUrl,
          thumbnail_url: finalCoverUrl || finalLogoUrl,
          gallery_images: finalGalleryUrls,
          business_details: resolvedBusinessJson,
          real_estate_details: nextRealEstateWithPano,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetListingId);

      if (updateErr) {
        throw new Error(updateErr.message || 'Failed updating listing details.');
      }

      // STEP D: Save schema-backed vertical table
      const verticalErr = await saveVerticalProfileToSupabase({
        supabase,
        listingId: targetListingId,
        hubId,
        vertical,
        bundle,
        isPrivilegedOfficialRole,
      });

      if (verticalErr) {
        console.warn('Vertical profile save notice:', verticalErr);
      }

      // STEP E: If Admin / Hub Manager chose immediate Publish, invoke server review approval so media becomes permanent_bound atomically
      if (desiredStatus === 'published' && isPrivilegedOfficialRole) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
        const approveRes = await fetch('/api/listings/review', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            listingId: targetListingId,
            action: 'approve',
            reviewerNotes: 'Published via authorized Workspace Listing Editor',
          }),
        });
        if (!approveRes.ok) {
          const j = (await approveRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            j?.error || 'Listing saved, but auto-publish approval failed.'
          );
        }
      }

      revokeMediaDraftPreviews(mediaDraft);
      setStatus('success');
      setConfirmAction(null);
      await onSaved?.(targetListingId, desiredStatus);
      onClose();
    } catch (err) {
      setStatus('error');
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to save listing.'
      );
      setConfirmAction(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted || !isOpen) return null;

  const selectableVerticals = VERTICAL_OPTIONS.filter(
    (opt) => opt.value !== 'public_civic' || isPrivilegedOfficialRole
  );

  const stepIdx = STEP_ITEMS.findIndex((s) => s.id === activeStep);

  return createPortal(
    <div
      className="fixed inset-0 z-[9980] bg-black/60 backdrop-blur-xs flex items-center justify-center sm:p-4"
      onClick={handleCloseSafely}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="existing-listing-editor-modal"
        aria-label={mode === 'create' ? 'Create Listing' : 'Edit Listing'}
        onClick={(e) => e.stopPropagation()}
        className="h-[100dvh] sm:h-[min(92dvh,880px)] w-full sm:max-w-4xl flex flex-col overflow-hidden bg-[var(--ps-surface)] sm:rounded-2xl border border-[var(--ps-border)] shadow-2xl text-[var(--ps-text)]"
      >
        {/* SHRINK-0 TOP HEADER + COMPLETENESS BAR + 4 STEP TABS */}
        <header className="shrink-0 bg-[var(--ps-surface)] border-b border-[var(--ps-border)]">
          <div className="px-4 sm:px-5 pt-3.5 pb-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight truncate">
                  {mode === 'create'
                    ? 'Create Multi-Vertical Listing'
                    : `Edit: ${title || initialListing?.title || 'Listing'}`}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/30">
                  {vertical.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Live Completeness Bar */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="w-32 h-1.5 rounded-full bg-[var(--ps-bg)] border border-[var(--ps-border)] overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      liveCompleteness.score >= 90
                        ? 'bg-emerald-500'
                        : liveCompleteness.score >= 65
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${liveCompleteness.score}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono font-bold">
                  {liveCompleteness.score}% Complete
                </span>
                {liveCompleteness.missingItems.slice(0, 3).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => jumpToMissingSection(item.section)}
                    className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] font-semibold text-amber-600 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                  >
                    + {item.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleCloseSafely}
              aria-label="Close listing editor"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step Tabs */}
          <div className="px-4 sm:px-5 pb-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {STEP_ITEMS.map((step) => {
              const active = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStep(step.id)}
                  className={`shrink-0 min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {step.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* SCROLLABLE BODY (flex-1 min-h-0 overflow-y-auto) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {errorBanner && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2.5 text-xs text-rose-600 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{errorBanner}</div>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* STEP 1: CORE & LOCATION */}
          {activeStep === 'core' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CustomSelectModal
                    label="Listing Vertical (Determines Features & Explore Marker)"
                    value={vertical}
                    onChange={(val) => setVertical(val as ListingVertical)}
                    disabled={mode === 'edit' && vertical === 'public_civic' && !isPrivilegedOfficialRole}
                    options={selectableVerticals.map((v) => ({
                      value: v.value,
                      label: v.label,
                      description: v.description,
                    }))}
                  />
                  <div>
                    <label className={LABEL_CLASS}>Subcategory Tag *</label>
                    <input
                      type="text"
                      value={subcategory}
                      onChange={(e) => setSubcategory(e.target.value)}
                      placeholder="e.g., Xerox & Print, Café, Football Turf, Plot"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>Business / Place Title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Official storefront or landmark name"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Short One-Line Pitch</label>
                    <input
                      type="text"
                      maxLength={140}
                      value={shortDescription}
                      onChange={(e) => setShortDescription(e.target.value)}
                      placeholder="Shown on compact search & map popups"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>
                      Search Tags (Comma-Separated)
                    </label>
                    <input
                      type="text"
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
                      placeholder="e.g., 24x7, spiral binding, student discount"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>Full Description</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Detailed services, landmarks, accepted payment methods, special highlights..."
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Contact Phone *</label>
                    <input
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+91 98620 XXXXX"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>WhatsApp Number</label>
                    <input
                      type="tel"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="Same or separate WhatsApp"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Contact Email</label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="desk@business.in"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </div>

              {/* Hub + Locality + Interactive Map Coordinate Picker */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CustomSelectModal
                    label="Service Hub *"
                    value={hubId}
                    onChange={(nextHubId) => {
                      setHubId(nextHubId);
                      const matched = hubs.find((h) => h.id === nextHubId);
                      if (matched) {
                        setCoordinates({
                          lat: matched.center_lat,
                          lng: matched.center_lng,
                        });
                      }
                    }}
                    options={hubs.map((h) => ({
                      value: h.id,
                      label: `${h.name}${h.state ? ` (${h.state})` : ''}`,
                    }))}
                  />
                  <div>
                    <LocalityCombobox
                      label="Locality / Veng / Area *"
                      hubId={hubId || undefined}
                      value={
                        localityName
                          ? { id: localityId, display_name: localityName }
                          : null
                      }
                      defaultLat={hubCenter?.lat ?? coordinates.lat}
                      defaultLng={hubCenter?.lng ?? coordinates.lng}
                      onSelect={(loc: LocalitySelection) => {
                        setLocalityId(loc.id);
                        setLocalityName(loc.display_name);
                        if (
                          typeof loc.lat === 'number' &&
                          typeof loc.lng === 'number'
                        ) {
                          const pt = { lat: loc.lat, lng: loc.lng };
                          setLocalityCoords(pt);
                          setCoordinates(pt);
                        }
                      }}
                      onClear={() => {
                        setLocalityId(null);
                        setLocalityName('');
                        setLocalityCoords(null);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>
                    Street Address / Landmark *
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Building floor, opposite landmark, road name..."
                    className={INPUT_CLASS}
                  />
                </div>

                <MapCoordinatePicker
                  coordinates={coordinates}
                  onChangeCoordinates={setCoordinates}
                  hubCenter={hubCenter}
                  hubLabel={selectedHubObj?.name}
                  localityCenter={
                    localityCoords ||
                    (() => {
                      const found = hubLocalities.find(
                        (l) =>
                          l.display_name.toLowerCase() ===
                          localityName.trim().toLowerCase()
                      );
                      return found?.lat && found?.lng
                        ? { lat: found.lat, lng: found.lng }
                        : null;
                    })()
                  }
                  localityLabel={localityName}
                  listingVertical={vertical}
                  propertyType={mappedUiPropertyType}
                  hasAssociatedPlot={
                    bundle.realEstate.propertyType === 'plot_land'
                  }
                  boundaryPolygon={bundle.realEstate.boundaryPolygon}
                  onChangeBoundaryPolygon={(poly, areaSqm, areaSqft) => {
                    setBundle((prev) => ({
                      ...prev,
                      realEstate: {
                        ...prev.realEstate,
                        boundaryPolygon: poly,
                        plotAreaSqm: areaSqm,
                        areaSqft: areaSqft > 0 ? areaSqft : prev.realEstate.areaSqft,
                      },
                    }));
                  }}
                  showExactPin={bundle.realEstate.showExactPin}
                  onChangeShowExactPin={(val) =>
                    setBundle((prev) => ({
                      ...prev,
                      realEstate: { ...prev.realEstate, showExactPin: val },
                    }))
                  }
                />
              </div>
            </div>
          )}

          {/* STEP 2: VERTICAL CONFIGURATION */}
          {activeStep === 'vertical' && (
            <div className="space-y-4">
              {isHydratingVertical ? (
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-8 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading saved {vertical.replace(/_/g, ' ')} profile...
                </div>
              ) : (
                <ListingVerticalFieldsSection
                  vertical={vertical}
                  bundle={bundle}
                  onChangeBundle={setBundle}
                  isPrivilegedOfficialRole={isPrivilegedOfficialRole}
                />
              )}
            </div>
          )}

          {/* STEP 3: MEDIA & OPERATING HOURS */}
          {activeStep === 'media_hours' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      Weekly Operating Hours
                    </h4>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      Tap a preset or enter custom hours shown on your public card.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HOURS_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setOpeningHours(preset.value)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                          openingHours === preset.value
                            ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] border-transparent'
                            : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={openingHours}
                  onChange={(e) => setOpeningHours(e.target.value)}
                  placeholder="Mon–Sat: 9:00 AM – 6:00 PM (Closed Sunday)"
                  className={INPUT_CLASS}
                />
              </div>

              <ListingMediaEditor
                draft={mediaDraft}
                onChange={setMediaDraft}
                maxMediaLimit={maxMediaQuota}
                showPanoramaSection={
                  vertical === 'real_estate' ||
                  vertical === 'hotel_stay' ||
                  vertical === 'booking_venue'
                }
                listingTitle={title || 'Listing'}
              />
            </div>
          )}

          {/* STEP 4: STAFF DELEGATION, EXPLORE PREVIEW & SUBMIT */}
          {activeStep === 'staff_preview' && (
            <div className="space-y-4">
              {/* Explore & Bookings Interconnection Preview */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[var(--ps-accent)]" />
                    Explore, Search &amp; Bookings Interconnection Preview
                  </h4>
                  <span className="text-[11px] font-mono text-[var(--ps-text-muted)]">
                    {coordinates.lat.toFixed(4)}, {coordinates.lng.toFixed(4)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full border-2 border-[var(--ps-accent)] bg-[var(--ps-bg)] overflow-hidden shrink-0 flex items-center justify-center">
                      {mediaDraft.logo?.previewUrl ? (
                        <img
                          src={mediaDraft.logo.previewUrl}
                          alt="Marker preview"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <MapPin className="w-5 h-5 text-[var(--ps-accent)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                        {title || 'Your Listing Title'}
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {subcategory} • {localityName || 'Select Locality'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-semibold">
                          {vertical.replace(/_/g, ' ')}
                        </span>
                        {vertical === 'print_digital' && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
                            <Printer className="w-2.5 h-2.5" /> Print Desk Ready
                          </span>
                        )}
                        {(vertical === 'booking_venue' ||
                          vertical === 'hotel_stay') && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 font-semibold inline-flex items-center gap-1">
                            <CalendarDays className="w-2.5 h-2.5" /> Listed in /bookings
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-1.5 text-xs">
                    <p className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      Connected App Surfaces
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      • Appears on Explore Map ({selectedHubObj?.name || 'Active Hub'}) &amp; Universal Search.
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      • Public CTAs are gated by{' '}
                      <code className="font-mono">get_effective_entitlements()</code>{' '}
                      ({can('print_online_orders') || bundle.print.isOfficialPrintswift ? 'Print Ready' : 'Standard Card'}).
                    </p>
                    {existingListingId && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> ID: {existingListingId.slice(0, 8)}…
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Staff Delegation Manager */}
              {!isStaffMode && (
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[var(--ps-accent)]" />
                    <h4 className="text-sm font-bold text-[var(--ps-text)]">
                      Staff &amp; Operator Access Delegation
                    </h4>
                  </div>
                  {existingListingId ? (
                    <StaffDelegationManager
                      listingId={existingListingId}
                      listingTitle={title || 'Listing'}
                    />
                  ) : (
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Save or submit this new listing first to receive a persistent
                      UUID and delegate staff permissions.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* SHRINK-0 FOOTER */}
        <footer className="shrink-0 px-4 sm:px-5 py-3 border-t border-[var(--ps-border)] bg-[var(--ps-bg)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {stepIdx > 0 && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setActiveStep(STEP_ITEMS[stepIdx - 1].id)}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            {stepIdx < STEP_ITEMS.length - 1 && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setActiveStep(STEP_ITEMS[stepIdx + 1].id)}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => requestConfirmSave('draft')}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save as Draft
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() =>
                requestConfirmSave(
                  isPrivilegedOfficialRole ? 'published' : 'pending_verification'
                )
              }
              className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] text-xs font-bold cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isPrivilegedOfficialRole ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" /> Save &amp; Publish
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Submit for Approval
                </>
              )}
            </button>
          </div>
        </footer>
      </div>

      {/* Explicit Confirmation Gate */}
      <ConfirmActionModal
        isOpen={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel || 'Confirm'}
        loading={isSubmitting}
        onConfirm={() => void executeSaveConfirmed()}
        onCancel={() => {
          if (!isSubmitting) setConfirmAction(null);
        }}
      />
    </div>,
    document.body
  );
}
