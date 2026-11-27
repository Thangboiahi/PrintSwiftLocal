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
  CreditCard,
  ExternalLink,
  Layers,
  Loader2,
  Lock,
  MapPin,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { PayPerCheckoutModal } from '@/components/monetization/PayPerCheckoutModal';
import {
  calculateClientPayPerQuote,
  convertSqftToUnit,
  DEFAULT_PAY_PER_CONFIGS,
  evaluateOwnerQuotaStatus,
  fetchPayPerPricingConfig,
  formatAreaEquivalentHint,
  type OwnerQuotaEvaluation,
  type PayPerModuleKey,
  type PayPerPricingConfig,
} from '@/lib/monetization/pay-per';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  LocalityCombobox,
  type LocalitySelection,
} from '@/components/ui/LocalityCombobox';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import {
  fetchPaymentPolicyForScope,
  normalizePaymentMode,
  type PaymentFeaturePolicyRow,
  type PaymentMode,
} from '@/lib/payments/resolver';
import { isUuid } from '@/lib/payments/types';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { calculateListingCompleteness } from '@/lib/rules';
import { useEntitlements } from '@/lib/subscriptions/entitlements';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { addDelegateByUserId } from '@/lib/supabase/delegations';
import type {
  LatLngPoint,
  Listing,
  ListingStatus,
  PropertyType,
} from '@/lib/types';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { stripRichTextToPlain } from '@/lib/utils/sanitize-rich-text';
import {
  getCategoryBreadcrumbPath,
  resolveListingRootKey,
} from '@/lib/taxonomy/categories';
import type { ListingVertical } from '@/lib/verticals/types';
import {
  StaffDelegationManager,
  type StagedStaffDelegation,
} from '../StaffDelegationManager';
import {
  ListingMediaEditor,
  revokeMediaDraftPreviews,
  uploadStagedListingMedia,
  type ListingMediaDraft,
  type StagedPanorama360View,
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
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';

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

const VERTICAL_SUBCATEGORY_CATALOG: Record<ListingVertical, string[]> = {
  print_digital: [
    'Xerox & Document Printing',
    'Digital Press & Flex Banner',
    'Photo Studio & ID Prints',
    'Cyber Café & Form Filling',
    'Spiral Binding & Lamination',
    'Stationery & Print Counter',
  ],
  restaurant_food: [
    'Restaurant & Dining',
    'Café & Coffee House',
    'Bakery & Confectionery',
    'Fast Food & Momos',
    'Traditional / Local Kitchen',
    'Cloud Kitchen & Takeaway',
  ],
  shop_catalogue: [
    'Grocery & Daily Needs',
    'Pharmacy & Medical Store',
    'Electronics & Mobile Shop',
    'Hardware & Building Materials',
    'Clothing, Fashion & Tailoring',
    'Bookstore & Stationery',
  ],
  booking_venue: [
    'Football & Futsal Turf',
    'Badminton / Indoor Court',
    'Community Hall & Auditorium',
    'Conference & Event Venue',
    'Recording / Photography Studio',
    'Gym & Fitness Arena',
  ],
  hotel_stay: [
    'Homestay & Guest House',
    'Hotel & Suites',
    'Traveller Lodge',
    'Resort & Farm Stay',
    'Service Apartment',
  ],
  real_estate: [
    'Residential Plot / Land',
    'Independent House / Villa',
    'Apartment / Flat',
    'Commercial Shop / Office',
    'PG / Hostel Room',
    'Agricultural / Farm Land',
  ],
  general: [
    'Local Retail & Services',
    'Clinic & Healthcare',
    'Coaching & Tuition Center',
    'Salon, Spa & Grooming',
    'Auto Workshop & Garage',
    'Home Repair & Technician',
  ],
  public_civic: [
    'Government Office',
    'Hospital & Emergency',
    'Police & Fire Station',
    'Bank & ATM',
    'School & College',
    'Transport Terminal',
  ],
};

interface SerializedSessionDraft {
  activeStep: EditorStepId;
  vertical: ListingVertical;
  title: string;
  subcategory: string;
  shortDescription: string;
  description: string;
  contactPhone: string;
  whatsapp: string;
  sameAsPhone: boolean;
  contactEmail: string;
  hubId: string;
  localityId: string | null;
  localityName: string;
  address: string;
  tagsText: string;
  coordinates: LatLngPoint;
  openingHours: string;
  bundle: VerticalFormBundle;
  stagedStaff: StagedStaffDelegation[];
  paymentMode?: PaymentMode;
  savedAt: string;
}

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
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

function extractExistingPanoramas360(
  listing?: Listing | null
): StagedPanorama360View[] {
  if (!listing) return [];
  if (Array.isArray(listing.panoramas_360) && listing.panoramas_360.length > 0) {
    return listing.panoramas_360
      .filter((p) => Boolean(p?.url?.trim()))
      .map((p, idx) => ({
        id: p.id || `pano-${idx + 1}`,
        label: p.label || `360° View ${idx + 1}`,
        item: {
          previewUrl: p.url,
          width: p.width || 2048,
          height: p.height || 1024,
          isStagedNew: false,
        },
        aspectRatioLabel: '2:1 Equirectangular',
      }));
  }
  const rePanos = listing.realEstateDetails?.panoramas || [];
  if (rePanos.length > 0) {
    return rePanos
      .filter((p) => Boolean(p?.imageUrl?.trim()))
      .map((p, idx) => ({
        id: p.id || `pano-${idx + 1}`,
        label: p.name || `360° View ${idx + 1}`,
        item: {
          previewUrl: p.imageUrl,
          width: p.width || 2048,
          height: p.height || 1024,
          isStagedNew: false,
        },
        aspectRatioLabel: '2:1 Equirectangular',
      }));
  }
  const singleUrl = listing.realEstateDetails?.panoramaUrl;
  if (singleUrl && singleUrl.trim()) {
    return [
      {
        id: 'pano-primary',
        label: 'Main 360° View',
        item: {
          previewUrl: singleUrl.trim(),
          width: 2048,
          height: 1024,
          isStagedNew: false,
        },
        aspectRatioLabel: '2:1 Equirectangular',
      },
    ];
  }
  return [];
}

function summarizeActiveVerticalFeatures(
  vertical: ListingVertical,
  bundle: VerticalFormBundle
): string[] {
  if (vertical === 'print_digital') {
    const list: string[] = [];
    if (bundle.print.isAcceptingOrders) list.push('Online Print Ordering');
    if (bundle.print.turnaroundBadge === 'express_30m')
      list.push('Express 30m SLA');
    if (bundle.print.supportsPickNDrop) list.push('Pick N Drop Dispatch');
    return list.length > 0 ? list : ['Directory Print Listing'];
  }
  if (vertical === 'restaurant_food') {
    const list: string[] = [];
    if (bundle.restaurant.isKitchenOpen) list.push('Online Menu Ordering');
    if (bundle.restaurant.allowTableBooking) list.push('Table Reservations');
    if (bundle.restaurant.allowPickNDrop) list.push('Pick N Drop Food Delivery');
    return list.length > 0 ? list : ['Food & Café Directory Card'];
  }
  if (vertical === 'shop_catalogue') {
    const list: string[] = [];
    if (bundle.shop.isAcceptingOrders) list.push('Online Basket Checkout');
    if (bundle.shop.allowCounterPickup) list.push('Counter Pickup & Stock Sync');
    if (bundle.shop.allowPickNDrop) list.push('Pick N Drop Dispatch');
    return list.length > 0 ? list : ['Retail Storefront Card'];
  }
  if (vertical === 'booking_venue') {
    const list: string[] = [];
    if (bundle.booking.isActive) {
      list.push('Online Slot Booking Calendar');
      list.push('Listed in /bookings Hub');
    }
    return list.length > 0 ? list : ['Venue Directory Card'];
  }
  if (vertical === 'hotel_stay') {
    const list: string[] = [];
    if (bundle.hotel.isAcceptingBookings) {
      list.push('Online Room & Stay Booking');
      list.push('Listed in /bookings Hub');
    }
    if (bundle.hotel.starterTotalRooms > 1) {
      list.push(`${bundle.hotel.starterTotalRooms} Rooms Inventory`);
    }
    return list.length > 0 ? list : ['Stay Directory Card'];
  }
  if (vertical === 'real_estate') {
    const list: string[] = [];
    if (bundle.realEstate.boundaryPolygon.length >= 3) {
      list.push('Zoom-In Interactive Plot Polygon');
    }
    if (bundle.realEstate.contactRevealPolicy === 'after_visit_accept') {
      list.push('Gated Site Visit Queue');
    } else {
      list.push('Direct Owner Call');
    }
    if (!bundle.realEstate.showExactPin) {
      list.push('Approx Locality Privacy Halo');
    }
    return list;
  }
  if (vertical === 'public_civic') {
    return [
      bundle.civic.is24x7 ? '24×7 Civic Helpline' : 'Civic Directory Record',
      `${bundle.civic.helplines.length} Helpline(s)`,
    ];
  }
  return ['Direct Phone & WhatsApp Callback', 'Pick N Drop Pin Snap'];
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
  const { hubs, activeHub, hubLocalities, categoriesFlat } = useAppConfig();

  const userRoleLower = String(
    authRole || user?.user_metadata?.role || ''
  ).toLowerCase();
  const isSuperAdmin =
    userRoleLower === 'super_admin' || userRoleLower === 'admin';
  const isHubManager = userRoleLower === 'hub_manager';
  const isPrivilegedOfficialRole = isSuperAdmin || isHubManager;
  const resolvedActorName =
    authFullName ||
    String(
      user?.user_metadata?.full_name ||
        user?.email?.split('@')[0] ||
        'Business Partner'
    );

  const existingListingId =
    mode === 'edit' && initialListing?.id && isUuid(initialListing.id)
      ? initialListing.id
      : null;
  const entitlementOwnerId = initialListing?.ownerId || user?.id || null;
  const { limit, can } = useEffectiveEntitlements(
    entitlementOwnerId,
    existingListingId
  );
  const {
    hasFeature: hasV15bFeature,
    entitlements: v15bEntitlements,
    canUseCategory,
  } = useEntitlements(entitlementOwnerId, existingListingId);

  // v17c Real Estate Quota vs. Pay-Per state
  const [reQuotaEval, setReQuotaEval] =
    useState<OwnerQuotaEvaluation | null>(null);
  const [rePricingConfig, setRePricingConfig] = useState<PayPerPricingConfig>(
    () => DEFAULT_PAY_PER_CONFIGS.real_estate_sale
  );
  const [rePayPerSelectedDays, setRePayPerSelectedDays] = useState<number>(30);
  const [optInRealEstatePayPer, setOptInRealEstatePayPer] =
    useState<boolean>(false);
  const [pendingPayPerCheckout, setPendingPayPerCheckout] = useState<{
    listingId: string;
    listingTitle: string;
    savedStatus: ListingStatus;
    moduleKey: PayPerModuleKey;
    priceInr: number;
    areaSqft: number;
  } | null>(null);
  const ownerOnlinePaymentEntitled =
    isSuperAdmin ||
    v15bEntitlements.is_super_admin_bypass ||
    hasV15bFeature('online_payment');
  const maxMediaQuota = limit('max_media_per_listing');
  const max360Quota = limit('max_360_panoramas');

  const draftStorageKey = useMemo(
    () => `dd_listing_draft_${user?.id || 'anon'}_${existingListingId || 'new'}`,
    [user?.id, existingListingId]
  );

  const [activeStep, setActiveStep] = useState<EditorStepId>('core');
  const [vertical, setVertical] = useState<ListingVertical>(
    resolveListingRootKey(
      initialListing?.root_key || initialListing?.listing_vertical || defaultVertical,
      initialListing?.category,
      initialListing?.is_civic_record
    )
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    initialListing?.category_id ?? null
  );
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    normalizePaymentMode(initialListing?.payment_mode)
  );
  const [verticalPaymentPolicy, setVerticalPaymentPolicy] =
    useState<PaymentFeaturePolicyRow | null>(null);
  const [title, setTitle] = useState(initialListing?.title || '');
  const [subcategory, setSubcategory] = useState(
    initialListing?.subcategory ||
      VERTICAL_SUBCATEGORY_CATALOG[
        initialListing?.listing_vertical || defaultVertical
      ]?.[0] ||
      'General'
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
  const [sameAsPhone, setSameAsPhone] = useState(false);
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
  const [localityCoords, setLocalityCoords] = useState<LatLngPoint | null>(
    null
  );
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
    panoramas360: [],
  });
  const [stagedStaff, setStagedStaff] = useState<StagedStaffDelegation[]>([]);

  const [isDirty, setIsDirty] = useState(false);
  const [resumedDraftNotice, setResumedDraftNotice] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const [isHydratingVertical, setIsHydratingVertical] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    targetStatus: ListingStatus;
    title: string;
    description: string;
    confirmLabel: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pass v17a: User-suggested leaf categories (pending_review) scoped to current user
  const [userPendingCategories, setUserPendingCategories] = useState<
    Array<{
      id: string;
      root_key: string;
      parent_id: string | null;
      depth: number;
      slug: string;
      display_name: string;
      review_status: 'pending_review' | 'official';
    }>
  >([]);
  const [showSuggestLeafForm, setShowSuggestLeafForm] = useState(false);
  const [suggestLeafParentId, setSuggestLeafParentId] = useState<string>('');
  const [suggestLeafName, setSuggestLeafName] = useState('');
  const [suggestLeafTouched, setSuggestLeafTouched] = useState(false);
  const [suggestLeafSubmitted, setSuggestLeafSubmitted] = useState(false);
  const [suggestLeafBusy, setSuggestLeafBusy] = useState(false);
  const [suggestLeafServerError, setSuggestLeafServerError] = useState<
    string | null
  >(null);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  // Load current user's own pending_review listing categories so they remain selectable
  useEffect(() => {
    if (!isOpen || !user?.id || !isSupabaseConfigured()) return;
    let active = true;
    queueMicrotask(() => {
      void supabase
        .from('categories')
        .select('id, root_key, parent_id, depth, slug, display_name, review_status')
        .eq('entity_type', 'listing')
        .eq('review_status', 'pending_review')
        .eq('suggested_by', user.id)
        .then(({ data }) => {
          if (!active || !Array.isArray(data)) return;
          setUserPendingCategories(
            data.map((r) => ({
              id: String(r.id),
              root_key: String(r.root_key || ''),
              parent_id: r.parent_id ? String(r.parent_id) : null,
              depth: Number(r.depth ?? 2),
              slug: String(r.slug || ''),
              display_name: String(r.display_name || r.slug || ''),
              review_status: 'pending_review',
            }))
          );
        });
    });
    return () => {
      active = false;
    };
  }, [isOpen, user?.id]);

  // Load 3-tier system payment policy for the selected listing vertical
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    queueMicrotask(() => {
      void fetchPaymentPolicyForScope(vertical).then((policy) => {
        if (active) setVerticalPaymentPolicy(policy);
      });
    });
    return () => {
      active = false;
    };
  }, [isOpen, vertical]);

  // Initialize state cleanly whenever modal opens or target listing changes
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    queueMicrotask(() => {
      if (!active) return;

      setErrorBanner(null);
      setConfirmAction(null);
      setShowLeaveConfirm(false);

      const initVertical =
        initialListing?.listing_vertical || defaultVertical || 'general';
      const selectedHubObj =
        hubs.find(
          (h) =>
            h.id === (initialListing?.hub_id || defaultHubId || activeHub?.id)
        ) || activeHub;

      // Check if an unsaved temporary draft exists in sessionStorage
      if (typeof window !== 'undefined') {
        try {
          const rawSaved = window.sessionStorage.getItem(draftStorageKey);
          if (rawSaved) {
            const parsed = JSON.parse(rawSaved) as SerializedSessionDraft;
            if (
              parsed &&
              typeof parsed === 'object' &&
              (parsed.title?.trim() ||
                parsed.description?.trim() ||
                parsed.address?.trim() ||
                (parsed.stagedStaff && parsed.stagedStaff.length > 0))
            ) {
              setActiveStep(parsed.activeStep || 'core');
              setVertical(parsed.vertical || initVertical);
              setTitle(parsed.title || '');
              setSubcategory(
                parsed.subcategory ||
                  VERTICAL_SUBCATEGORY_CATALOG[parsed.vertical || initVertical]?.[0] ||
                  'General'
              );
              setShortDescription(parsed.shortDescription || '');
              setDescription(parsed.description || '');
              setContactPhone(parsed.contactPhone || '');
              setWhatsapp(parsed.whatsapp || '');
              setSameAsPhone(Boolean(parsed.sameAsPhone));
              setContactEmail(parsed.contactEmail || '');
              setHubId(
                parsed.hubId ||
                  initialListing?.hub_id ||
                  defaultHubId ||
                  selectedHubObj?.id ||
                  ''
              );
              setLocalityId(parsed.localityId ?? null);
              setLocalityName(parsed.localityName || '');
              setAddress(parsed.address || '');
              setTagsText(parsed.tagsText || '');
              setCoordinates(
                parsed.coordinates || {
                  lat: selectedHubObj?.center_lat || 24.3335,
                  lng: selectedHubObj?.center_lng || 93.6978,
                }
              );
              setOpeningHours(
                parsed.openingHours || 'Mon–Sat: 9:00 AM – 6:00 PM'
              );
              setBundle(
                parsed.bundle || createInitialVerticalBundle(initialListing)
              );
              setPaymentMode(
                normalizePaymentMode(
                  parsed.paymentMode || initialListing?.payment_mode
                )
              );
              setStagedStaff(
                Array.isArray(parsed.stagedStaff) ? parsed.stagedStaff : []
              );
              setIsDirty(true);
              setResumedDraftNotice(true);
              return;
            }
          }
        } catch {
          // Ignore malformed sessionStorage draft
        }
      }

      setActiveStep('core');
      setResumedDraftNotice(false);
      setIsDirty(false);
      setVertical(initVertical);
      setCategoryId(initialListing?.category_id ?? null);
      setTitle(initialListing?.title || '');
      setSubcategory(
        initialListing?.subcategory ||
          VERTICAL_SUBCATEGORY_CATALOG[initVertical]?.[0] ||
          'General'
      );
      setShortDescription(initialListing?.shortDescription || '');
      setDescription(initialListing?.description || '');
      setContactPhone(initialListing?.contactPhone || '');
      setWhatsapp(initialListing?.whatsapp || '');
      setSameAsPhone(
        Boolean(
          initialListing?.contactPhone &&
            initialListing?.whatsapp &&
            initialListing.contactPhone === initialListing.whatsapp
        )
      );
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
      setPaymentMode(normalizePaymentMode(initialListing?.payment_mode));
      setStagedStaff([]);

      const existingLogo = extractExistingLogoUrl(initialListing);
      const existingCover = initialListing?.coverImage || null;
      const existingPanos = extractExistingPanoramas360(initialListing);

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
          panorama: existingPanos[0]?.item || null,
          panoramas360: existingPanos,
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
            if (active) setBundle(hydrated);
          })
          .finally(() => {
            if (active) setIsHydratingVertical(false);
          });
      }
    });

    return () => {
      active = false;
    };
  }, [
    isOpen,
    mode,
    initialListing,
    defaultHubId,
    defaultVertical,
    hubs,
    activeHub,
    draftStorageKey,
  ]);

  // Persist structured draft to sessionStorage whenever dirty state or step changes
  useEffect(() => {
    if (!isOpen || !isDirty || typeof window === 'undefined') return;
    try {
      const payload: SerializedSessionDraft = {
        activeStep,
        vertical,
        title,
        subcategory,
        shortDescription,
        description,
        contactPhone,
        whatsapp: sameAsPhone ? contactPhone : whatsapp,
        sameAsPhone,
        contactEmail,
        hubId,
        localityId,
        localityName,
        address,
        tagsText,
        coordinates,
        openingHours,
        bundle,
        stagedStaff,
        paymentMode,
        savedAt: new Date().toISOString(),
      };
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore sessionStorage quota errors
    }
  }, [
    isOpen,
    isDirty,
    paymentMode,
    activeStep,
    vertical,
    title,
    subcategory,
    shortDescription,
    description,
    contactPhone,
    whatsapp,
    sameAsPhone,
    contactEmail,
    hubId,
    localityId,
    localityName,
    address,
    tagsText,
    coordinates,
    openingHours,
    bundle,
    stagedStaff,
    draftStorageKey,
  ]);

  // Browser beforeunload guard when dirty
  useEffect(() => {
    if (!isOpen || !isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOpen, isDirty]);

  // v17c: Load Real Estate quota & dynamic pricing rules when vertical === 'real_estate'
  const reModuleKey: PayPerModuleKey =
    bundle.realEstate.dealType === 'rent'
      ? 'real_estate_rent'
      : 'real_estate_sale';

  useEffect(() => {
    if (!isOpen || vertical !== 'real_estate') return;
    let active = true;
    void Promise.all([
      evaluateOwnerQuotaStatus(entitlementOwnerId, reModuleKey),
      fetchPayPerPricingConfig(reModuleKey),
    ]).then(([quotaRes, cfgRes]) => {
      if (!active) return;
      setReQuotaEval(quotaRes);
      setRePricingConfig(cfgRes);
      const popular =
        cfgRes.duration_slabs.find((s) => s.is_popular) ||
        cfgRes.duration_slabs[0];
      if (popular) setRePayPerSelectedDays(popular.days);
      if (mode === 'create' && !quotaRes.hasRemainingQuota) {
        setOptInRealEstatePayPer(true);
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, vertical, entitlementOwnerId, reModuleKey, mode]);

  const resolvedReAreaSqft = useMemo(() => {
    const explicitSqft = Number(bundle.realEstate.areaSqft) || 0;
    if (explicitSqft > 0) return explicitSqft;
    const plotSqm = Number(bundle.realEstate.plotAreaSqm) || 0;
    return plotSqm > 0 ? Math.round(plotSqm * 10.7639104) : 0;
  }, [bundle.realEstate.areaSqft, bundle.realEstate.plotAreaSqm]);

  const liveRealEstateQuote = useMemo(() => {
    return calculateClientPayPerQuote(rePricingConfig, {
      durationDays: rePayPerSelectedDays,
      propertyPriceInr: Number(bundle.realEstate.priceInr) || 0,
      areaValue: resolvedReAreaSqft,
      areaUnit: 'sqft',
    });
  }, [
    rePricingConfig,
    rePayPerSelectedDays,
    bundle.realEstate.priceInr,
    resolvedReAreaSqft,
  ]);

  // Escape key guard
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmAction && !showLeaveConfirm) {
        if (isDirty) {
          setShowLeaveConfirm(true);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, confirmAction, showLeaveConfirm, onClose]);

  // Clean up un-uploaded memory blobs on unmount
  useEffect(() => {
    return () => {
      revokeMediaDraftPreviews(mediaDraft);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearSessionDraft = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(draftStorageKey);
      } catch {
        // Ignore
      }
    }
  }, [draftStorageKey]);

  const handleDiscardResumedDraft = () => {
    clearSessionDraft();
    revokeMediaDraftPreviews(mediaDraft);
    const initVertical =
      initialListing?.listing_vertical || defaultVertical || 'general';
    const selectedHubObj =
      hubs.find(
        (h) =>
          h.id === (initialListing?.hub_id || defaultHubId || activeHub?.id)
      ) || activeHub;
    setVertical(initVertical);
    setTitle('');
    setSubcategory(VERTICAL_SUBCATEGORY_CATALOG[initVertical]?.[0] || 'General');
    setShortDescription('');
    setDescription('');
    setContactPhone('');
    setWhatsapp('');
    setSameAsPhone(false);
    setContactEmail('');
    setHubId(selectedHubObj?.id || '');
    setLocalityId(null);
    setLocalityName('');
    setAddress('');
    setTagsText('');
    setCoordinates({
      lat: selectedHubObj?.center_lat || 24.3335,
      lng: selectedHubObj?.center_lng || 93.6978,
    });
    setOpeningHours('Mon–Sat: 9:00 AM – 6:00 PM');
    setBundle(createInitialVerticalBundle(null));
    setMediaDraft({
      logo: null,
      cover: null,
      gallery: [],
      panorama: null,
      panoramas360: [],
    });
    setStagedStaff([]);
    setResumedDraftNotice(false);
    setIsDirty(false);
  };

  const handleAttemptClose = useCallback(() => {
    if (isSubmitting) return;
    if (isDirty) {
      setShowLeaveConfirm(true);
      return;
    }
    revokeMediaDraftPreviews(mediaDraft);
    onClose();
  }, [isSubmitting, isDirty, mediaDraft, onClose]);

  const handleConfirmDiscardAndLeave = useCallback(() => {
    clearSessionDraft();
    revokeMediaDraftPreviews(mediaDraft);
    setShowLeaveConfirm(false);
    setIsDirty(false);
    onClose();
  }, [clearSessionDraft, mediaDraft, onClose]);

  const handleSwitchVertical = (nextVal: string) => {
    const nextVertical = nextVal as ListingVertical;
    setVertical(nextVertical);
    setCategoryId(null);
    markDirty();
    const catalogForNext = VERTICAL_SUBCATEGORY_CATALOG[nextVertical] || [];
    const allKnownCatalogSubcats = Object.values(
      VERTICAL_SUBCATEGORY_CATALOG
    ).flat();
    if (
      !subcategory.trim() ||
      subcategory === 'General' ||
      allKnownCatalogSubcats.includes(subcategory)
    ) {
      setSubcategory(catalogForNext[0] || 'General');
    }
  };

  // v16b + v17a: Active L2 & L3 categories strictly scoped to the selected immutable L1 root_key (`vertical`),
  // plus the current user's own pending_review leaf suggestions under this root.
  const scopedRootTaxonomy = useMemo(() => {
    const listingNodes = (categoriesFlat || []).filter(
      (n) =>
        n.entity_type === 'listing' &&
        n.is_active &&
        (n.root_key || (!n.parent_id ? n.slug : '')) === vertical
    );
    const rootNode =
      listingNodes.find((n) => !n.parent_id || n.depth === 1) ?? null;
    const descendants = listingNodes
      .filter((n) => n.parent_id !== null)
      .sort(
        (a, b) =>
          a.depth - b.depth ||
          a.sort_order - b.sort_order ||
          a.display_name.localeCompare(b.display_name)
      );

    const officialIds = new Set(listingNodes.map((n) => n.id));
    const pendingForRoot = userPendingCategories.filter(
      (p) => p.root_key === vertical && !officialIds.has(p.id)
    );
    const pendingIdSet = new Set(pendingForRoot.map((p) => p.id));

    const permittedOptions: CustomSelectOption[] = [];
    let restrictedCount = 0;

    for (const node of descendants) {
      const allowed = isSuperAdmin || canUseCategory(node);
      if (!allowed) {
        restrictedCount += 1;
        continue;
      }
      const trail = getCategoryBreadcrumbPath(categoriesFlat, node.id);
      const label =
        trail.length >= 3
          ? `${trail[1].display_name} › ${trail[2].display_name}`
          : node.display_name;
      permittedOptions.push({
        value: node.id,
        label,
        description: `Level-${Math.max(2, trail.length)} · /${node.slug}`,
      });
    }

    for (const pCat of pendingForRoot) {
      const parentNode = pCat.parent_id
        ? listingNodes.find((n) => n.id === pCat.parent_id)
        : null;
      const label =
        parentNode && parentNode.depth === 2
          ? `${parentNode.display_name} › ${pCat.display_name} (Pending Review)`
          : `${pCat.display_name} (Pending Review)`;
      permittedOptions.push({
        value: pCat.id,
        label,
        description: `Level-${pCat.depth} · Pending Superadmin Review`,
      });
    }

    // Valid parents for suggesting a new leaf (L1 Root + active L2 nodes under this vertical)
    const suggestParentOptions: CustomSelectOption[] = [];
    if (rootNode) {
      suggestParentOptions.push({
        value: rootNode.id,
        label: `${rootNode.display_name} (Root — creates Level-2)`,
        description: `/${rootNode.slug}`,
      });
    }
    for (const node of descendants) {
      if (node.depth === 2) {
        suggestParentOptions.push({
          value: node.id,
          label: `${node.display_name} (Level-2 — creates Level-3)`,
          description: `/${node.slug}`,
        });
      }
    }

    return {
      rootNode,
      descendants,
      pendingForRoot,
      pendingIdSet,
      permittedOptions,
      suggestParentOptions,
      restrictedCount,
    };
  }, [
    categoriesFlat,
    vertical,
    isSuperAdmin,
    canUseCategory,
    userPendingCategories,
  ]);

  const isSelectedCategoryPending = Boolean(
    categoryId && scopedRootTaxonomy.pendingIdSet.has(categoryId)
  );

  // Default parent for "+ Suggest a new category under [Selected Parent]"
  const defaultSuggestParentNode = useMemo(() => {
    if (categoryId) {
      const selected = scopedRootTaxonomy.descendants.find(
        (n) => n.id === categoryId
      );
      if (selected) {
        if (selected.depth === 2) return selected;
        if (selected.depth === 3 && selected.parent_id) {
          const l2Parent = scopedRootTaxonomy.descendants.find(
            (n) => n.id === selected.parent_id
          );
          if (l2Parent) return l2Parent;
        }
      }
    }
    return scopedRootTaxonomy.rootNode;
  }, [categoryId, scopedRootTaxonomy]);

  const suggestLeafFieldError = useMemo(() => {
    const clean = suggestLeafName.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      return 'Category name must be at least 2 characters.';
    }
    if (clean.length > 60) {
      return 'Category name must be 60 characters or fewer.';
    }
    return null;
  }, [suggestLeafName]);

  const handleOpenSuggestLeaf = useCallback(() => {
    setSuggestLeafParentId(
      defaultSuggestParentNode?.id || scopedRootTaxonomy.rootNode?.id || ''
    );
    setSuggestLeafName('');
    setSuggestLeafTouched(false);
    setSuggestLeafSubmitted(false);
    setSuggestLeafServerError(null);
    setShowSuggestLeafForm(true);
  }, [defaultSuggestParentNode, scopedRootTaxonomy.rootNode]);

  const handleSubmitSuggestLeaf = useCallback(async () => {
    setSuggestLeafSubmitted(true);
    if (suggestLeafFieldError) return;
    const targetParentId =
      suggestLeafParentId ||
      defaultSuggestParentNode?.id ||
      scopedRootTaxonomy.rootNode?.id;
    if (!targetParentId) {
      setSuggestLeafServerError('Select a parent category first.');
      return;
    }

    const cleanName = suggestLeafName.trim().replace(/\s+/g, ' ');
    setSuggestLeafBusy(true);
    setSuggestLeafServerError(null);
    setStatus('saving', 'Suggesting new category…');
    try {
      const { data, error } = await supabase.rpc('suggest_leaf_category', {
        p_parent_id: targetParentId,
        p_name: cleanName,
        p_hub_id: hubId || null,
      });
      if (error) {
        throw new Error(error.message);
      }
      const payload = (data || {}) as { category?: Record<string, unknown> };
      const cat = payload.category;
      if (!cat || !cat.id) {
        throw new Error('Could not create suggested category.');
      }

      const newId = String(cat.id);
      const newName = String(cat.display_name || cleanName);
      const newSlug = String(cat.slug || '');
      const reviewStatus =
        String(cat.review_status || 'pending_review') === 'official'
          ? 'official'
          : 'pending_review';

      if (reviewStatus === 'pending_review') {
        setUserPendingCategories((prev) =>
          prev.some((p) => p.id === newId)
            ? prev
            : [
                ...prev,
                {
                  id: newId,
                  root_key: String(cat.root_key || vertical),
                  parent_id: cat.parent_id ? String(cat.parent_id) : targetParentId,
                  depth: Number(cat.depth ?? 2),
                  slug: newSlug,
                  display_name: newName,
                  review_status: 'pending_review',
                },
              ]
        );
      }

      setCategoryId(newId);
      setSubcategory(newName);
      markDirty();
      setShowSuggestLeafForm(false);
      setSuggestLeafName('');
      setSuggestLeafTouched(false);
      setSuggestLeafSubmitted(false);
      setStatus(
        'success',
        reviewStatus === 'official'
          ? `Selected existing category "${newName}".`
          : `Suggested "${newName}" (Pending Superadmin Review).`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to suggest category.';
      setSuggestLeafServerError(msg);
      setStatus('error', msg);
    } finally {
      setSuggestLeafBusy(false);
    }
  }, [
    defaultSuggestParentNode,
    markDirty,
    scopedRootTaxonomy.rootNode,
    setStatus,
    suggestLeafFieldError,
    suggestLeafName,
    suggestLeafParentId,
    vertical,
  ]);

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

  const subcategoryOptions: CustomSelectOption[] = useMemo(() => {
    const base = VERTICAL_SUBCATEGORY_CATALOG[vertical] || ['General'];
    const opts: CustomSelectOption[] = base.map((item) => ({
      value: item,
      label: item,
    }));
    if (subcategory.trim() && !base.includes(subcategory.trim())) {
      opts.unshift({
        value: subcategory.trim(),
        label: `${subcategory.trim()} (Custom)`,
      });
    }
    return opts;
  }, [vertical, subcategory]);

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

    const plainDesc = stripRichTextToPlain(description);

    const mockListing: Listing = {
      id: existingListingId || 'draft',
      hub_id: hubId || null,
      locality_id: localityId,
      listing_vertical: vertical,
      title: title.trim(),
      category: legacyCategory,
      subcategory: subcategory.trim() || 'General',
      shortDescription: shortDescription.trim(),
      description: plainDesc,
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
              catalogue: [
                {
                  id: '1',
                  listingId: 'draft',
                  name: 'Sample',
                  category: subcategory,
                  description: '',
                  price: 0,
                  variants: [],
                  availability: 'in_stock',
                  imageUrl: '',
                },
              ],
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

  const validateBeforeConfirm = (): string | null => {
    if (!title.trim() || title.trim().length < 3) {
      return 'Please enter a valid listing title (minimum 3 characters).';
    }
    if (!hubId) {
      return 'Please select a Service Hub.';
    }
    if (!localityName.trim()) {
      return 'Please select or enter a Locality name.';
    }
    if (!contactPhone.trim()) {
      return 'A contact phone number is required before submitting.';
    }
    if (vertical === 'public_civic' && !isPrivilegedOfficialRole) {
      return 'Only Hub Managers or Super-Admins can create or edit Public Civic records.';
    }
    const unnamedPano = (mediaDraft.panoramas360 || []).find(
      (v) => !v.label || !v.label.trim()
    );
    if (unnamedPano) {
      return 'Please enter a Custom View Name for every 360° panorama view in Step 3.';
    }
    return null;
  };

  const activeFeaturesList = useMemo(
    () => summarizeActiveVerticalFeatures(vertical, bundle),
    [vertical, bundle]
  );

  const cleanPreviewTitle = useMemo(() => {
    const raw = title.trim() || initialListing?.title || '';
    if (!raw) return 'Your Listing Title';
    return splitSamplePrefix(raw).title || raw;
  }, [title, initialListing?.title]);

  const requestConfirmSubmit = (targetStatus: ListingStatus) => {
    const err = validateBeforeConfirm();
    if (err) {
      setErrorBanner(err);
      if (err.includes('360°')) {
        setActiveStep('media_hours');
      } else {
        setActiveStep('core');
      }
      return;
    }
    setErrorBanner(null);

    const panoCount = (mediaDraft.panoramas360 || []).length;
    const mediaSummaryParts: string[] = [];
    if (mediaDraft.logo) mediaSummaryParts.push('1 Logo');
    if (mediaDraft.cover) mediaSummaryParts.push('1 Cover');
    if (mediaDraft.gallery.length > 0)
      mediaSummaryParts.push(`${mediaDraft.gallery.length} Gallery photo(s)`);
    if (panoCount > 0) mediaSummaryParts.push(`${panoCount} Named 360° view(s)`);
    const mediaSummary =
      mediaSummaryParts.length > 0
        ? mediaSummaryParts.join(', ')
        : 'No custom photos attached';

    const hubSummary = `${localityName.trim()}, ${
      selectedHubObj?.name || 'Selected Hub'
    } (${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)})`;

    const staffSummary =
      mode === 'create' && stagedStaff.length > 0
        ? ` • Team: ${stagedStaff
            .map((s) => `@${s.staff_username}`)
            .join(', ')}`
        : '';

    if (mode === 'create') {
      setConfirmAction({
        targetStatus,
        title:
          targetStatus === 'published' && isPrivilegedOfficialRole
            ? 'Create & Publish Listing Live?'
            : 'Submit Listing for Verification?',
        description: `Vertical: ${vertical.replace(
          /_/g,
          ' '
        )} (${subcategory}) • Location: ${hubSummary} • Media: ${mediaSummary} • Features: ${activeFeaturesList.join(
          ', '
        )}${staffSummary}. Staged photos will be uploaded under temporary 14-day pending-verification storage until approved.`,
        confirmLabel:
          targetStatus === 'published' && isPrivilegedOfficialRole
            ? 'Confirm & Publish Live'
            : 'Submit Listing for Verification',
      });
    } else {
      setConfirmAction({
        targetStatus,
        title: 'Save & Update Listing?',
        description: `Update "${cleanPreviewTitle}" (${vertical.replace(
          /_/g,
          ' '
        )}) in ${hubSummary} • Media: ${mediaSummary} • Features: ${activeFeaturesList.join(
          ', '
        )}.`,
        confirmLabel: 'Save & Update Listing',
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

      const finalWhatsapp = (sameAsPhone ? contactPhone : whatsapp).trim();

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

      const resolvedServiceDetailsJson =
        vertical === 'general'
          ? {
              ...(initialListing?.serviceDetails || {}),
              areasServed: bundle.general.serviceAreasText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              startingPrice:
                bundle.general.startingPriceInr > 0
                  ? bundle.general.startingPriceInr
                  : null,
              experienceYears:
                bundle.general.experienceYears > 0
                  ? bundle.general.experienceYears
                  : 0,
              priceRange: bundle.general.priceRange,
              deliveryInfo: bundle.general.deliveryInfo.trim() || null,
              highlights: bundle.general.highlightsText
                .split(',')
                .map((h) => h.trim())
                .filter(Boolean),
            }
          : initialListing?.serviceDetails ?? null;

      // Resolve canonical category_id (selected L2/L3 within root, or L1 system root fallback)
      const resolvedCategoryId =
        categoryId && isUuid(categoryId)
          ? categoryId
          : scopedRootTaxonomy.rootNode && isUuid(scopedRootTaxonomy.rootNode.id)
            ? scopedRootTaxonomy.rootNode.id
            : initialListing?.category_id ?? null;

      // STEP A: Obtain genuine PostgreSQL UUID ONLY now on confirmed submit!
      let targetListingId = existingListingId;
      if (!targetListingId) {
        const insertPayload: Record<string, unknown> = {
          owner_id: effectiveOwnerId,
          owner_name: resolvedActorName,
          hub_id: hubId,
          category_id: resolvedCategoryId,
          root_key: vertical,
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
          whatsapp: finalWhatsapp || null,
          contact_email: contactEmail.trim() || null,
          opening_hours: openingHours.trim() || null,
          lat: coordinates.lat,
          lng: coordinates.lng,
          coordinates,
          business_details: resolvedBusinessJson,
          real_estate_details: resolvedRealEstateJson,
          service_details: resolvedServiceDetailsJson,
        };

        let { data: insertedRow, error: insertErr } = await supabase
          .from('listings')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insertErr && /root_key/i.test(insertErr.message)) {
          delete insertPayload.root_key;
          const retry = await supabase
            .from('listings')
            .insert(insertPayload)
            .select('id')
            .single();
          insertedRow = retry.data;
          insertErr = retry.error;
        }

        if (insertErr || !insertedRow?.id) {
          throw new Error(
            insertErr?.message || 'Failed to create listing row.'
          );
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
      const finalPanoramas360 = uploadResult.panoramas360 || [];

      const nextRealEstateWithPano =
        resolvedRealEstateJson && finalPanoramas360.length > 0
          ? {
              ...resolvedRealEstateJson,
              panoramaUrl: finalPanoramaUrl,
              panoramas: finalPanoramas360.map((p, idx) => ({
                id: p.id || `pano-${idx + 1}`,
                name: p.label || `360° View ${idx + 1}`,
                imageUrl: p.url,
                width: p.width || 2048,
                height: p.height || 1024,
                isEquirectangular: true,
                isSyntheticDemo: false,
                isPrimary: idx === 0,
                order: idx + 1,
                sceneType: 'interior' as const,
              })),
            }
          : resolvedRealEstateJson;

      const summary = buildVerticalSummary(
        vertical,
        bundle,
        finalLogoUrl,
        contactPhone.trim()
      );

      // STEP C: Update listings core record with resolved media URLs + vertical summary + panoramas_360 + category_id + root_key
      const baseUpdatePayload: Record<string, unknown> = {
        hub_id: hubId,
        category_id: resolvedCategoryId,
        root_key: vertical,
        locality_id: localityId,
        custom_tags: cleanTags,
        listing_vertical: vertical,
        is_civic_record: vertical === 'public_civic',
        vertical_summary: summary,
        payment_mode:
          verticalPaymentPolicy &&
          (!verticalPaymentPolicy.upi_enabled || !ownerOnlinePaymentEntitled) &&
          (paymentMode === 'upi' || paymentMode === 'both')
            ? 'manual'
            : paymentMode,
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
        whatsapp: finalWhatsapp || null,
        contact_email: contactEmail.trim() || null,
        opening_hours: openingHours.trim() || null,
        lat: coordinates.lat,
        lng: coordinates.lng,
        coordinates,
        logo_url: finalLogoUrl,
        cover_image: finalCoverUrl,
        // v21a (P0-07): `listings.thumbnail_url` does not exist — cover_image/logo_url are canonical.
        gallery_images: finalGalleryUrls,
        panoramas_360: finalPanoramas360,
        business_details: resolvedBusinessJson,
        real_estate_details: nextRealEstateWithPano,
        service_details: resolvedServiceDetailsJson,
        updated_at: new Date().toISOString(),
      };

      // v21a (P0-18): owner-only placement/payment fields are never written from Staff mode
      // (the DB guard `guard_staff_listing_mutations_v18a` rejects staff changes to them).
      if (isStaffMode) {
        delete baseUpdatePayload.payment_mode;
        delete baseUpdatePayload.listing_vertical;
        delete baseUpdatePayload.root_key;
        delete baseUpdatePayload.is_civic_record;
        delete baseUpdatePayload.hub_id;
      }

      const { error: updateErr } = await supabase
        .from('listings')
        .update(baseUpdatePayload)
        .eq('id', targetListingId);

      if (updateErr) {
        // Retry ONLY for schema drift (PostgREST PGRST204 "column not found"), stripping the
        // optional v15b/v16b columns that may be missing on older databases.
        const isMissingColumn =
          updateErr.code === 'PGRST204' ||
          /could not find the .* column|column .* does not exist/i.test(
            updateErr.message || ''
          );
        if (!isMissingColumn) {
          throw new Error(updateErr.message || 'Failed updating listing details.');
        }
        delete baseUpdatePayload.panoramas_360;
        delete baseUpdatePayload.payment_mode;
        delete baseUpdatePayload.root_key;
        const { error: retryErr } = await supabase
          .from('listings')
          .update(baseUpdatePayload)
          .eq('id', targetListingId);
        if (retryErr) {
          throw new Error(
            retryErr.message || 'Failed updating listing details.'
          );
        }
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

      // STEP E: Persist any staged staff delegations (for newly created listings)
      if (!existingListingId && stagedStaff.length > 0) {
        for (const staffItem of stagedStaff) {
          try {
            await addDelegateByUserId(
              targetListingId,
              {
                id: staffItem.staff_id,
                username: staffItem.staff_username,
                full_name: staffItem.staff_name,
                avatar_url: staffItem.staff_avatar_url,
              },
              staffItem.permissions,
              staffItem.vertical_scopes
            );
          } catch (staffErr) {
            console.warn('Staged staff delegation notice:', staffErr);
          }
        }
      }

      // STEP F: If Admin / Hub Manager chose immediate Publish, invoke server review approval
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

      clearSessionDraft();
      revokeMediaDraftPreviews(mediaDraft);
      setIsDirty(false);
      setStatus('success');
      setConfirmAction(null);

      const requiresOrChosePayPer =
        vertical === 'real_estate' &&
        !isPrivilegedOfficialRole &&
        (optInRealEstatePayPer ||
          (mode === 'create' && reQuotaEval && !reQuotaEval.hasRemainingQuota));

      if (requiresOrChosePayPer) {
        setPendingPayPerCheckout({
          listingId: targetListingId,
          listingTitle: title.trim(),
          savedStatus: desiredStatus,
          moduleKey: reModuleKey,
          priceInr: Number(bundle.realEstate.priceInr) || 0,
          areaSqft: resolvedReAreaSqft,
        });
        return;
      }

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

  const activeVerticalMeta =
    selectableVerticals.find((v) => v.value === vertical) ||
    VERTICAL_OPTIONS[0];

  const stepIdx = STEP_ITEMS.findIndex((s) => s.id === activeStep);

  return createPortal(
    <div
      className="fixed inset-0 z-[88] bg-black/60 backdrop-blur-xs flex items-center justify-center sm:p-4"
      onClick={handleAttemptClose}
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
                    : `Edit: ${cleanPreviewTitle}`}
                </h2>
                <span
                  data-testid="editor-header-vertical-badge"
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/30"
                >
                  {activeVerticalMeta.label}
                </span>
                {isDirty && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    Unsaved Temp Draft
                  </span>
                )}
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
              onClick={handleAttemptClose}
              aria-label="Close listing editor"
              data-testid="listing-editor-close-btn"
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
                  data-testid={`editor-step-tab-${step.id}`}
                  className={`shrink-0 min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {step.id === 'staff_preview' && isStaffMode
                    ? '4. Preview & Submit'
                    : step.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* SCROLLABLE BODY (flex-1 min-h-0 overflow-y-auto) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Resumed Temporary Draft Banner */}
          {resumedDraftNotice && (
            <div
              data-testid="resumed-draft-banner"
              className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200"
            >
              <div className="flex items-center gap-2 font-semibold">
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>Resumed your unfinished draft</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscardResumedDraft}
                  data-testid="discard-resumed-draft-btn"
                  className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-300 font-bold text-[11px] hover:bg-rose-500/25 cursor-pointer"
                >
                  Discard Draft
                </button>
                <button
                  type="button"
                  onClick={() => setResumedDraftNotice(false)}
                  className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
                  aria-label="Dismiss resumed draft notice"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

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
                {/* Quick 1-Tap Vertical Switcher Pills + CustomSelectModal (Owner / Admin only; locked in Staff mode) */}
                {!isStaffMode && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-[var(--ps-text)]">
                        Choose Listing Vertical (Determines Step 2 Features &amp; Map Pin) *
                      </span>
                      <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        Switch anytime without losing Step 1 data
                      </span>
                    </div>
                    <div
                      role="radiogroup"
                      aria-label="Listing Vertical Quick Switcher"
                      className="flex flex-wrap gap-1.5"
                    >
                      {selectableVerticals.map((v) => {
                        const active = vertical === v.value;
                        return (
                          <button
                            key={v.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            data-testid={`vertical-pill-${v.value}`}
                            onClick={() => handleSwitchVertical(v.value)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                              active
                                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] border-transparent shadow-xs'
                                : 'bg-[var(--ps-surface)] text-[var(--ps-text)] border-[var(--ps-border)] hover:border-[var(--ps-accent)]'
                            }`}
                          >
                            {v.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <CustomSelectModal
                    label={
                      isStaffMode
                        ? 'Listing Vertical (Owner Locked)'
                        : 'Listing Vertical Dropdown'
                    }
                    value={vertical}
                    onChange={handleSwitchVertical}
                    testId="listing-editor-vertical-select"
                    disabled={
                      isStaffMode ||
                      (mode === 'edit' &&
                        vertical === 'public_civic' &&
                        !isPrivilegedOfficialRole)
                    }
                    options={selectableVerticals.map((v) => ({
                      value: v.value,
                      label: `${v.label} — ${v.description}`,
                    }))}
                  />
                  <div className="space-y-1.5">
                    {scopedRootTaxonomy.permittedOptions.length > 0 ? (
                      <>
                        <CustomSelectModal
                          label={`Category (L2 / L3 under ${scopedRootTaxonomy.rootNode?.display_name || vertical}) *`}
                          value={categoryId || ''}
                          onChange={(nextCatId) => {
                            setCategoryId(nextCatId || null);
                            const matched =
                              scopedRootTaxonomy.descendants.find(
                                (n) => n.id === nextCatId
                              ) ||
                              scopedRootTaxonomy.pendingForRoot.find(
                                (n) => n.id === nextCatId
                              );
                            if (matched) {
                              setSubcategory(matched.display_name);
                            }
                            markDirty();
                          }}
                          testId="listing-editor-taxonomy-category-select"
                          options={scopedRootTaxonomy.permittedOptions}
                          placeholder="Select Level-2 or Level-3 category..."
                        />

                        {isSelectedCategoryPending && (
                          <div
                            data-testid="listing-editor-pending-category-pill"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                          >
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>Pending Superadmin Review</span>
                          </div>
                        )}

                        {scopedRootTaxonomy.restrictedCount > 0 && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                            <Lock className="h-3 w-3 shrink-0" />
                            <span>
                              {scopedRootTaxonomy.restrictedCount} category
                              option
                              {scopedRootTaxonomy.restrictedCount === 1
                                ? ''
                                : 's'}{' '}
                              require an upgraded subscription plan.
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <CustomSelectModal
                        label="Subcategory Tag *"
                        value={subcategory}
                        onChange={(nextSub) => {
                          setSubcategory(nextSub);
                          markDirty();
                        }}
                        testId="listing-editor-subcategory-select"
                        options={subcategoryOptions}
                      />
                    )}

                    {/* Pass v17a: User-Suggested Leaf Category Action (Owner/Admin only) */}
                    {!isStaffMode && scopedRootTaxonomy.rootNode && isSupabaseConfigured() && (
                      <div className="pt-0.5">
                        {!showSuggestLeafForm ? (
                          <button
                            type="button"
                            data-testid="suggest-leaf-category-btn"
                            onClick={handleOpenSuggestLeaf}
                            className="inline-flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
                          >
                            <span className="inline-flex items-center gap-1.5 truncate">
                              <Sparkles className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                              <span className="truncate">
                                + Suggest a new category under{' '}
                                {defaultSuggestParentNode?.display_name ||
                                  scopedRootTaxonomy.rootNode.display_name}
                              </span>
                            </span>
                            <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)]" />
                          </button>
                        ) : (
                          <div
                            data-testid="suggest-leaf-category-panel"
                            className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 p-3 space-y-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-bold text-[var(--ps-text)]">
                                Suggest New Leaf Category
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowSuggestLeafForm(false)}
                                className="text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>

                            <CustomSelectModal
                              label="Parent Category (Level-1 or Level-2)"
                              value={suggestLeafParentId}
                              onChange={setSuggestLeafParentId}
                              options={scopedRootTaxonomy.suggestParentOptions}
                              placeholder="Choose parent category..."
                            />

                            <div className="space-y-1">
                              <input
                                type="text"
                                value={suggestLeafName}
                                onChange={(e) => {
                                  setSuggestLeafName(e.target.value);
                                  setSuggestLeafTouched(true);
                                  setSuggestLeafServerError(null);
                                }}
                                onBlur={() => setSuggestLeafTouched(true)}
                                maxLength={60}
                                placeholder="e.g. Solar Inverter Repair"
                                data-testid="suggest-leaf-category-input"
                                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
                              />
                              {(suggestLeafTouched || suggestLeafSubmitted) &&
                                suggestLeafFieldError && (
                                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                                    {suggestLeafFieldError}
                                  </p>
                                )}
                              {suggestLeafServerError && (
                                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                                  {suggestLeafServerError}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-[var(--ps-text-muted)]">
                                Usable immediately — Superadmin reviews later.
                              </span>
                              <button
                                type="button"
                                disabled={suggestLeafBusy}
                                onClick={() => void handleSubmitSuggestLeaf()}
                                data-testid="suggest-leaf-category-submit"
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-90 disabled:opacity-50 cursor-pointer shrink-0"
                              >
                                {suggestLeafBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                                <span>Add &amp; Select</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <input
                      type="text"
                      value={subcategory}
                      onChange={(e) => {
                        setSubcategory(e.target.value);
                        markDirty();
                      }}
                      placeholder="Display label / custom subcategory tag..."
                      data-testid="listing-editor-custom-subcategory-input"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-1 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>Business / Place Title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      markDirty();
                    }}
                    placeholder="Official storefront or landmark name"
                    data-testid="listing-editor-title-input"
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
                      onChange={(e) => {
                        setShortDescription(e.target.value);
                        markDirty();
                      }}
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
                      onChange={(e) => {
                        setTagsText(e.target.value);
                        markDirty();
                      }}
                      placeholder="e.g., 24x7, spiral binding, student discount"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                {/* Custom-UI Rich Text Editor for Full Description */}
                <div>
                  <RichTextEditor
                    id="listing-editor-rich-description"
                    label="Full Description / Business Info"
                    value={description}
                    onChange={(html) => {
                      setDescription(html);
                      markDirty();
                    }}
                    placeholder="Detailed services, landmarks, accepted payment methods, special highlights..."
                    minRows={4}
                    testId="listing-editor-rich-text"
                  />
                </div>

                {/* Country Code Phone Inputs + Same as Contact Phone Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <PhoneInputWithCountry
                      id="listing-editor-contact-phone"
                      label="Contact Phone"
                      required
                      value={contactPhone}
                      onChange={(nextPhone) => {
                        setContactPhone(nextPhone);
                        if (sameAsPhone) setWhatsapp(nextPhone);
                        markDirty();
                      }}
                      testId="listing-editor-phone-input"
                    />
                  </div>
                  <div>
                    <PhoneInputWithCountry
                      id="listing-editor-whatsapp"
                      label="WhatsApp Number"
                      value={sameAsPhone ? contactPhone : whatsapp}
                      onChange={(nextWa) => {
                        setWhatsapp(nextWa);
                        markDirty();
                      }}
                      sameAsPhoneChecked={sameAsPhone}
                      onSameAsPhoneChange={(checked) => {
                        setSameAsPhone(checked);
                        if (checked) setWhatsapp(contactPhone);
                        markDirty();
                      }}
                      sameAsPhoneLabel="Same as Phone"
                      sourcePhoneValue={contactPhone}
                      testId="listing-editor-whatsapp-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-[var(--text-primary,var(--ps-text))]">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => {
                        setContactEmail(e.target.value);
                        markDirty();
                      }}
                      placeholder="desk@business.in"
                      className="w-full h-10 px-3 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                </div>
              </div>

              {/* Hub + Locality + Interactive Map Coordinate Picker */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CustomSelectModal
                    label={
                      isStaffMode ? 'Service Hub (Owner Locked)' : 'Service Hub *'
                    }
                    value={hubId}
                    disabled={isStaffMode}
                    onChange={(nextHubId) => {
                      setHubId(nextHubId);
                      markDirty();
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
                        markDirty();
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
                        markDirty();
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
                    onChange={(e) => {
                      setAddress(e.target.value);
                      markDirty();
                    }}
                    placeholder="Building floor, opposite landmark, road name..."
                    className={INPUT_CLASS}
                  />
                </div>

                <MapCoordinatePicker
                  mode={
                    vertical === 'real_estate' &&
                    bundle.realEstate.boundaryPolygon.length >= 3
                      ? 'polygon'
                      : 'point'
                  }
                  coordinates={coordinates}
                  onChangeCoordinates={(nextCoords) => {
                    setCoordinates(nextCoords);
                    markDirty();
                  }}
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
                  hasAssociatedPlot={true}
                  boundaryPolygon={bundle.realEstate.boundaryPolygon}
                  onChangeBoundaryPolygon={(poly, areaSqm, areaSqft) => {
                    markDirty();
                    setBundle((prev) => ({
                      ...prev,
                      realEstate: {
                        ...prev.realEstate,
                        boundaryPolygon: poly,
                        plotAreaSqm: areaSqm,
                        areaSqft:
                          areaSqft > 0 ? areaSqft : prev.realEstate.areaSqft,
                        areaValue:
                          areaSqft > 0
                            ? convertSqftToUnit(areaSqft, prev.realEstate.areaUnit)
                            : prev.realEstate.areaValue,
                      },
                    }));
                  }}
                  showExactPin={bundle.realEstate.showExactPin}
                  onChangeShowExactPin={(val) => {
                    markDirty();
                    setBundle((prev) => ({
                      ...prev,
                      realEstate: { ...prev.realEstate, showExactPin: val },
                    }));
                  }}
                />
              </div>
            </div>
          )}

          {/* STEP 2: VERTICAL CONFIGURATION + SUBSCRIPTION-GATED FEATURE INTEGRATIONS */}
          {activeStep === 'vertical' && (
            <div className="space-y-4">
              {/* Listing-Level Payment Mode (Owner/Admin only; Staff cannot mutate payment modes) */}
              {isStaffMode ? (
                <div
                  data-testid="listing-editor-payment-mode-staff-locked"
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-4 py-3 flex items-center gap-2.5 text-xs text-[var(--ps-text-muted)]"
                >
                  <Lock className="w-4 h-4 shrink-0 text-[var(--ps-accent)]" />
                  <span>
                    Checkout payment mode is locked to{' '}
                    <strong className="text-[var(--ps-text)] uppercase">
                      {paymentMode}
                    </strong>{' '}
                    and can only be changed by the business owner.
                  </span>
                </div>
              ) : (
              <div
                data-testid="listing-editor-payment-mode-card"
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      Listing Checkout Payment Mode
                    </h4>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      Choose how customers pay this listing. Options blocked by platform policy or your active subscription are automatically locked.
                    </p>
                  </div>
                  {verticalPaymentPolicy?.escrow_required && (
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">
                      Escrow Required
                    </span>
                  )}
                </div>

                {verticalPaymentPolicy &&
                !verticalPaymentPolicy.allow_listing_override ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 text-[11px] text-[var(--ps-text-muted)]">
                    <Lock className="w-3.5 h-3.5 shrink-0 text-[var(--ps-accent)]" />
                    <span>
                      System policy locks payment methods for{' '}
                      <strong className="text-[var(--ps-text)]">
                        {verticalPaymentPolicy.label}
                      </strong>{' '}
                      (Manual:{' '}
                      {verticalPaymentPolicy.manual_enabled ? 'ON' : 'OFF'} ·
                      UPI: {verticalPaymentPolicy.upi_enabled ? 'ON' : 'OFF'}).
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(
                      [
                        {
                          id: 'manual',
                          label: 'Manual Only',
                          desc: 'Pay in-person, cash, or manual bank/UPI confirmation.',
                        },
                        {
                          id: 'upi',
                          label: 'UPI Online Only',
                          desc: 'Instant digital UPI checkout on DD oodle.',
                        },
                        {
                          id: 'both',
                          label: 'UPI + Manual',
                          desc: 'Offer both online UPI and manual payment.',
                        },
                      ] as const
                    ).map((opt) => {
                      const sysUpiOn =
                        verticalPaymentPolicy?.upi_enabled ?? true;
                      const sysManualOn =
                        verticalPaymentPolicy?.manual_enabled ?? true;
                      const needsUpi = opt.id === 'upi' || opt.id === 'both';
                      const needsManual =
                        opt.id === 'manual' || opt.id === 'both';

                      let disabledReason: string | null = null;
                      if (needsUpi && !sysUpiOn) {
                        disabledReason = 'UPI disabled by platform policy';
                      } else if (needsUpi && !ownerOnlinePaymentEntitled) {
                        disabledReason = 'Requires plan with Online UPI';
                      } else if (needsManual && !sysManualOn) {
                        disabledReason = 'Manual disabled by platform policy';
                      }

                      const isSelected = paymentMode === opt.id;
                      const isDisabled = Boolean(disabledReason);

                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={isDisabled}
                          data-testid={`listing-payment-mode-${opt.id}`}
                          onClick={() => {
                            setPaymentMode(opt.id);
                            markDirty();
                          }}
                          className={`flex min-h-[44px] flex-col items-start justify-between rounded-xl border p-3 text-left transition ${
                            isSelected
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                          } ${
                            isDisabled
                              ? 'cursor-not-allowed opacity-55'
                              : 'cursor-pointer hover:border-[var(--ps-accent)]/60'
                          }`}
                        >
                          <div className="flex w-full items-center justify-between gap-1.5">
                            <span className="text-xs font-bold">
                              {opt.label}
                            </span>
                            {isDisabled ? (
                              <Lock className="w-3.5 h-3.5 text-[var(--ps-text-muted)] shrink-0" />
                            ) : isSelected ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                            ) : null}
                          </div>
                          <span className="mt-1 text-[10px] leading-snug text-[var(--ps-text-muted)]">
                            {disabledReason || opt.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              )}

              {vertical === 'real_estate' && (
                <div
                  data-testid="real-estate-pay-per-quote-card"
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-[var(--ps-accent)]" />
                      <h4 className="text-xs font-bold text-[var(--ps-text)]">
                        Real Estate Plan Quota &amp; Live Pay-Per Quote (
                        {bundle.realEstate.dealType === 'rent'
                          ? 'For Rent / Lease'
                          : 'For Sale'}
                        )
                      </h4>
                    </div>
                    {reQuotaEval ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                          reQuotaEval.hasRemainingQuota
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {reQuotaEval.hasRemainingQuota ? (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>
                              Included in your {reQuotaEval.planName} (
                              {reQuotaEval.remainingCount === null
                                ? 'Unlimited'
                                : `${reQuotaEval.remainingCount} remaining`}
                              )
                            </span>
                          </>
                        ) : (
                          <>
                            <Ticket className="w-3.5 h-3.5" />
                            <span>
                              Plan Listing Quota Reached ({reQuotaEval.usedCount}/
                              {reQuotaEval.maxLimit ?? 0}) · Pay-Per Publish
                              Available
                            </span>
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    {rePricingConfig.duration_slabs.map((slab) => {
                      const selected =
                        liveRealEstateQuote.duration_days === slab.days;
                      return (
                        <button
                          key={slab.id}
                          type="button"
                          onClick={() => setRePayPerSelectedDays(slab.days)}
                          className={`flex min-h-[52px] flex-col justify-between rounded-xl border p-2.5 text-left transition cursor-pointer ${
                            selected
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          <span className="text-[11px] font-bold text-[var(--ps-text)]">
                            {slab.label}
                          </span>
                          <span className="text-xs font-extrabold text-[var(--ps-accent)]">
                            Base ₹{slab.price_inr.toLocaleString('en-IN')}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-[11px] text-[var(--ps-text-muted)]">
                    <div>
                      <span>
                        Base ₹{liveRealEstateQuote.base_slab_inr} + Value Band (
                        {liveRealEstateQuote.price_band_label || '₹0'}): +₹
                        {liveRealEstateQuote.price_band_inr} + Area Band (
                        {liveRealEstateQuote.area_band_label ||
                          formatAreaEquivalentHint(resolvedReAreaSqft)}
                        ): +₹{liveRealEstateQuote.area_band_inr}
                      </span>
                    </div>
                    <div className="text-xs font-extrabold text-[var(--ps-accent)]">
                      Pay-Per Total: ₹
                      {liveRealEstateQuote.total_inr.toLocaleString('en-IN')} /{' '}
                      {liveRealEstateQuote.duration_days}d
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ps-text)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={
                          optInRealEstatePayPer ||
                          Boolean(
                            mode === 'create' &&
                              reQuotaEval &&
                              !reQuotaEval.hasRemainingQuota
                          )
                        }
                        disabled={Boolean(
                          mode === 'create' &&
                            reQuotaEval &&
                            !reQuotaEval.hasRemainingQuota
                        )}
                        onChange={(e) =>
                          setOptInRealEstatePayPer(e.target.checked)
                        }
                        className="h-4 w-4 rounded border-[var(--ps-border)] text-[var(--ps-accent)]"
                      />
                      <span>
                        {reQuotaEval && !reQuotaEval.hasRemainingQuota
                          ? `Required: Open Pay-Per Property Checkout (₹${liveRealEstateQuote.total_inr.toLocaleString('en-IN')}) after saving`
                          : `Optional: Publish with Pay-Per Property Pass (₹${liveRealEstateQuote.total_inr.toLocaleString('en-IN')}) instead of plan quota`}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {isHydratingVertical ? (
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-8 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading saved {vertical.replace(/_/g, ' ')} profile...
                </div>
              ) : (
                <ListingVerticalFieldsSection
                  vertical={vertical}
                  bundle={bundle}
                  onChangeBundle={(nextBundle) => {
                    setBundle(nextBundle);
                    markDirty();
                  }}
                  isPrivilegedOfficialRole={isPrivilegedOfficialRole}
                  canUseFeature={(featureKey) =>
                    can(featureKey as Parameters<typeof can>[0])
                  }
                />
              )}
            </div>
          )}

          {/* STEP 3: MEDIA, NAMED MULTI-360° VIEWS & OPERATING HOURS */}
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
                      Tap a preset or enter custom hours shown on your public
                      card.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HOURS_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setOpeningHours(preset.value);
                          markDirty();
                        }}
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
                  onChange={(e) => {
                    setOpeningHours(e.target.value);
                    markDirty();
                  }}
                  placeholder="Mon–Sat: 9:00 AM – 6:00 PM (Closed Sunday)"
                  className={INPUT_CLASS}
                />
              </div>

              <ListingMediaEditor
                draft={mediaDraft}
                onChange={(nextDraft) => {
                  setMediaDraft(nextDraft);
                  markDirty();
                }}
                maxMediaLimit={maxMediaQuota}
                max360Limit={max360Quota}
                showPanoramaSection={true}
                listingTitle={cleanPreviewTitle}
              />
            </div>
          )}

          {/* STEP 4: STAFF DELEGATION (@USERNAME), EXPLORE PREVIEW & SUBMIT */}
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
                      <p
                        data-testid="step4-preview-clean-title"
                        className="text-xs font-bold text-[var(--ps-text)] truncate"
                      >
                        {cleanPreviewTitle}
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {subcategory} • {localityName || 'Select Locality'} •{' '}
                        {selectedHubObj?.name || 'Active Hub'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-bold">
                          {activeVerticalMeta.label}
                        </span>
                        {vertical === 'print_digital' &&
                          bundle.print.isAcceptingOrders && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
                              <Printer className="w-2.5 h-2.5" /> Print Ordering
                              Active
                            </span>
                          )}
                        {(vertical === 'booking_venue' ||
                          vertical === 'hotel_stay') && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 font-semibold inline-flex items-center gap-1">
                            <CalendarDays className="w-2.5 h-2.5" /> Listed in
                            /bookings
                          </span>
                        )}
                        {(mediaDraft.panoramas360?.length || 0) > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
                            <Compass className="w-2.5 h-2.5" />{' '}
                            {mediaDraft.panoramas360?.length}× 360° Views
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-1.5 text-xs">
                    <p className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      Connected App Surfaces ({selectedHubObj?.name || 'Hub'})
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      • Appears on{' '}
                      <strong className="text-[var(--ps-text)]">
                        {selectedHubObj?.name || 'Active Hub'}
                      </strong>{' '}
                      Explore Map &amp; Universal Search.
                    </p>
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <span className="text-[11px] text-[var(--ps-text-muted)]">
                        • Enabled Integrations:
                      </span>
                      {activeFeaturesList.map((feat) => (
                        <span
                          key={feat}
                          className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                        >
                          {feat}
                        </span>
                      ))}
                    </div>
                    {existingListingId ? (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> ID:{' '}
                        {existingListingId.slice(0, 8)}…
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-600 dark:text-amber-300 font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Temporary Draft —
                        Written to DB only on Submit
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Staff Delegation Manager (Works on Brand-New Drafts & Saved Listings!) */}
              {!isStaffMode && (
                <StaffDelegationManager
                  listingId={existingListingId}
                  listingTitle={cleanPreviewTitle}
                  listingVertical={vertical}
                  stagedStaff={stagedStaff}
                  onChangeStagedStaff={(nextStaged) => {
                    setStagedStaff(nextStaged);
                    markDirty();
                  }}
                />
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
                data-testid="listing-editor-back-btn"
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
                data-testid="listing-editor-next-btn"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {mode === 'create' ? (
              <>
                {isPrivilegedOfficialRole && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => requestConfirmSubmit('published')}
                    data-testid="listing-editor-publish-live-btn"
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" /> Publish Live (Admin)
                  </button>
                )}
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => requestConfirmSubmit('pending_verification')}
                  data-testid="listing-editor-submit-verification-btn"
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] text-xs font-bold cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" /> Submit Listing for
                  Verification
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  requestConfirmSubmit(
                    isPrivilegedOfficialRole
                      ? 'published'
                      : initialListing?.status === 'published'
                        ? 'published'
                        : 'pending_verification'
                  )
                }
                data-testid="listing-editor-save-update-btn"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] text-xs font-bold cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <Save className="w-3.5 h-3.5" /> Save &amp; Update Listing
              </button>
            )}
          </div>
        </footer>
      </div>

      {/* Explicit Submission / Update Confirmation Gate (z-[95]) */}
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

      {/* Unsaved Leave / Close Confirmation Guard (z-[95]) */}
      <ConfirmActionModal
        isOpen={showLeaveConfirm}
        title="Leave Listing Form?"
        description="Your changes are only saved temporarily and have not been submitted yet. Would you like to continue editing or discard this draft?"
        confirmLabel="Discard & Leave"
        cancelLabel="Continue Editing"
        variant="danger"
        onConfirm={handleConfirmDiscardAndLeave}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      {pendingPayPerCheckout ? (
        <PayPerCheckoutModal
          open={Boolean(pendingPayPerCheckout)}
          onClose={() => {
            const snap = pendingPayPerCheckout;
            setPendingPayPerCheckout(null);
            if (snap) {
              void onSaved?.(snap.listingId, snap.savedStatus);
            }
            onClose();
          }}
          moduleKey={pendingPayPerCheckout.moduleKey}
          targetTable="listings"
          targetId={pendingPayPerCheckout.listingId}
          targetTitle={pendingPayPerCheckout.listingTitle}
          initialDurationDays={rePayPerSelectedDays}
          initialPropertyPriceInr={pendingPayPerCheckout.priceInr}
          initialAreaValue={pendingPayPerCheckout.areaSqft}
          initialAreaUnit="sqft"
          onSuccess={() => {
            const snap = pendingPayPerCheckout;
            setPendingPayPerCheckout(null);
            if (snap) {
              void onSaved?.(snap.listingId, snap.savedStatus);
            }
            onClose();
          }}
        />
      ) : null}
    </div>,
    document.body
  );
}
