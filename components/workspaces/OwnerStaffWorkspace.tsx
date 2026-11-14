'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowUp,
  BarChart3,
  Building2,
  Compass,
  Copy,
  Edit3,
  Eye,
  FileSpreadsheet,
  History,
  Inbox,
  Layers,
  MapPin,
  MessageSquare,
  Package,
  Plus,
  Send,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useAppStore, useAuth } from '@/lib/store';
import {
  createListing,
  deleteListing,
  fetchListings,
  updateListing,
} from '@/lib/supabase/listings';
import {
  CatalogueProduct,
  Listing,
  ListingCategory,
  ListingStatus,
  PanoramaScene,
  PropertyType,
  StaffPermission,
} from '@/lib/types';
import {
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
  applyEditorCategoryChange,
  applyEditorPropertyTypeChange,
  calculateListingCompleteness,
  formatAreaValue,
  hasValidMandatoryPanorama,
  shouldShowPlotAndBoundary,
  validatePanoramaScene,
} from '@/lib/rules';
import {
  generateCoverImageDataUri,
  generateEquirectangularPanoramaDataUri,
  generateProductImageDataUri,
} from '@/lib/media-generator';
import {
  ImportValidationResult,
  downloadListingImportTemplate,
  parseAndValidateListingImportFile,
} from '@/lib/excel-utils';
import { DataTable, DataColumn } from '@/components/shared/DataTable';
import { PanoramaViewer360 } from '@/components/real-estate/PanoramaViewer360';
import { CategoryDetailView } from '@/components/listings/CategoryDetailView';
import { AnalyticsWidget } from '@/components/shared/AnalyticsWidget';
import { CompletenessIndicator } from '@/components/shared/CompletenessIndicator';

interface OwnerStaffWorkspaceProps {
  onOpenListingOnMap: (listingId: string) => void;
  initialDraftListing?: Listing | null;
  onClearInitialDraftListing?: () => void;
}

type OwnerTab =
  | 'overview'
  | 'listings'
  | 'catalogues'
  | 'enquiries'
  | 'reviews'
  | 'analytics'
  | 'staff';

const ALL_STAFF_PERMISSIONS: { id: StaffPermission; label: string }[] = [
  { id: 'edit_details', label: 'Edit Listing Details' },
  { id: 'manage_media', label: 'Manage Photos & 360° Media' },
  { id: 'manage_catalogue', label: 'Manage Product Catalogue' },
  { id: 'reply_enquiries', label: 'Reply to Enquiries' },
  { id: 'reply_reviews', label: 'Reply to Reviews' },
  { id: 'view_analytics', label: 'View Performance Analytics' },
];

export default function OwnerStaffWorkspace({
  onOpenListingOnMap,
  initialDraftListing,
  onClearInitialDraftListing,
}: OwnerStaffWorkspaceProps) {
  const {
    currentUser,
    listings,
    areaUnit,
    enquiries,
    reviews,
    notifications,
    markNotificationRead,
    saveListing,
    duplicateListing,
    changeListingStatus,
    restoreListingVersion,
    importListingsBatch,
    saveCatalogueProduct,
    deleteCatalogueProduct,
    replyToEnquiry,
    replyToReview,
    reportReview,
    staffDelegations,
    saveStaffDelegation,
    revokeStaffDelegation,
    hasStaffPermission,
    dynamicFields,
  } = useAppStore();
  const { user: authUser } = useAuth();
  const [supabaseOwnerListings, setSupabaseOwnerListings] = useState<Listing[]>(
    []
  );
  const [isCreatingSupabaseListing, setIsCreatingSupabaseListing] =
    useState(false);

  const isStaffMode = currentUser.roleType === 'staff';
  const effectiveOwnerId =
    authUser?.id ||
    (currentUser.roleType === 'owner' ? currentUser.id : 'owner-1');

  // Phase 3-C: Fetch authenticated user's listings from Supabase
  useEffect(() => {
    let active = true;
    fetchListings(effectiveOwnerId)
      .then((remoteListings) => {
        if (!active) return;
        setSupabaseOwnerListings(remoteListings);
      })
      .catch(() => {
        // Fallback to local state when Supabase table or network is unavailable
      });
    return () => {
      active = false;
    };
  }, [effectiveOwnerId]);

  // Filter listings accessible to current Owner or delegated Staff (merged with Supabase listings)
  const accessibleListings = useMemo(() => {
    const baseListings = (() => {
      if (currentUser.roleType === 'admin') return listings;
      if (currentUser.roleType === 'owner') {
        return listings.filter(
          (l) => l.ownerId === currentUser.id || l.ownerId === effectiveOwnerId
        );
      }
      if (currentUser.roleType === 'staff') {
        const activeDelegations = staffDelegations.filter(
          (d) => d.staffUserId === currentUser.id && d.status === 'active'
        );
        const allowedIds = new Set(
          activeDelegations.flatMap((d) => d.assignedListingIds)
        );
        return listings.filter(
          (l) =>
            allowedIds.has(l.id) || l.assignedStaffIds?.includes(currentUser.id)
        );
      }
      // Visitor previewing owner workspace sees owner-1 sample portfolio
      return listings.filter(
        (l) => l.ownerId === 'owner-1' || l.ownerId === effectiveOwnerId
      );
    })();

    if (supabaseOwnerListings.length === 0) return baseListings;
    const seenIds = new Set(baseListings.map((l) => l.id));
    const merged = [...baseListings];
    for (const remoteItem of supabaseOwnerListings) {
      if (!seenIds.has(remoteItem.id)) {
        merged.unshift(remoteItem);
        seenIds.add(remoteItem.id);
      }
    }
    return merged;
  }, [
    listings,
    currentUser,
    staffDelegations,
    effectiveOwnerId,
    supabaseOwnerListings,
  ]);

  const [activeTab, setActiveTab] = useState<OwnerTab>('overview');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Listing Editor Drawer / Modal State
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [editorSection, setEditorSection] = useState<
    'basics' | 'category' | 'media' | 'versions'
  >('basics');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [previewListing, setPreviewListing] = useState<Listing | null>(null);

  // Consume initialDraftListing when launched from Explore Map "Create Listing Here"
  useEffect(() => {
    if (!initialDraftListing) return;
    queueMicrotask(() => {
      setActiveTab('listings');
      setEditorError(null);
      setEditorSection('basics');
      setEditingListing(initialDraftListing);
      setStatusBanner({
        type: 'info',
        text: `Launched existing Listing Editor from map geometry (${String(
          initialDraftListing.customFields?.sourceGeometryType || 'shape'
        ).toUpperCase()} — "${
          initialDraftListing.customFields?.sourceGeometryLabel ||
          initialDraftListing.title
        }"). Ready to review and save as Draft.`,
      });
      if (onClearInitialDraftListing) {
        onClearInitialDraftListing();
      }
    });
  }, [initialDraftListing, onClearInitialDraftListing]);

  // Custom Panorama Scene Input State
  const [newPanoramaName, setNewPanoramaName] = useState('Panorama 1 — Living Room');

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportValidationResult | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Catalogue Tab State
  const businessListings = useMemo(
    () => accessibleListings.filter((l) => l.category === 'business'),
    [accessibleListings]
  );
  const [selectedCatalogueBizId, setSelectedCatalogueBizId] = useState<string>(
    () => businessListings[0]?.id || ''
  );
  const [catalogueSearch, setCatalogueSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<CatalogueProduct | null>(
    null
  );

  // Enquiries Tab State
  const accessibleListingIds = useMemo(
    () => new Set(accessibleListings.map((l) => l.id)),
    [accessibleListings]
  );
  const ownerEnquiries = useMemo(
    () => enquiries.filter((e) => accessibleListingIds.has(e.listingId)),
    [enquiries, accessibleListingIds]
  );
  const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(
    null
  );
  const [enquiryReplyDraft, setEnquiryReplyDraft] = useState('');
  const [enquiryStatusFilter, setEnquiryStatusFilter] = useState<string>('all');

  // Reviews Tab State
  const ownerReviews = useMemo(
    () => reviews.filter((r) => accessibleListingIds.has(r.listingId)),
    [reviews, accessibleListingIds]
  );
  const [reviewReplyDrafts, setReviewReplyDrafts] = useState<
    Record<string, string>
  >({});

  // Analytics Tab State
  const [analyticsRange, setAnalyticsRange] = useState<'7d' | '30d' | '90d'>(
    '30d'
  );

  // Staff Delegation Form State
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [selectedDelegationListings, setSelectedDelegationListings] = useState<
    string[]
  >([]);
  const [selectedPermissions, setSelectedPermissions] = useState<
    StaffPermission[]
  >(['edit_details', 'manage_catalogue', 'reply_enquiries']);

  // Summary KPIs
  const kpis = useMemo(() => {
    const total = accessibleListings.length;
    const draft = accessibleListings.filter((l) => l.status === 'draft').length;
    const submitted = accessibleListings.filter(
      (l) => l.status === 'submitted' || l.status === 'pending_verification'
    ).length;
    const published = accessibleListings.filter(
      (l) => l.status === 'published'
    ).length;
    const changesRequested = accessibleListings.filter(
      (l) => l.status === 'changes_requested'
    ).length;
    const archivedOrSuspended = accessibleListings.filter(
      (l) =>
        l.status === 'archived' ||
        l.status === 'suspended' ||
        l.status === 'rejected' ||
        l.status === 'expired'
    ).length;

    const views = accessibleListings.reduce((s, l) => s + l.viewsCount, 0);
    const mapImpressions = accessibleListings.reduce(
      (s, l) => s + l.mapImpressionsCount,
      0
    );
    const detailVisits = accessibleListings.reduce(
      (s, l) => s + l.detailVisitsCount,
      0
    );
    const follows = accessibleListings.reduce((s, l) => s + l.followsCount, 0);
    const openEnquiries = ownerEnquiries.filter(
      (e) => e.status !== 'resolved'
    ).length;

    const needsAttention = accessibleListings.filter(
      (l) =>
        l.status === 'changes_requested' ||
        (l.category === 'real_estate' && !hasValidMandatoryPanorama(l)) ||
        calculateListingCompleteness(l).score < 80
    );

    return {
      total,
      draft,
      submitted,
      published,
      changesRequested,
      archivedOrSuspended,
      views,
      mapImpressions,
      detailVisits,
      follows,
      openEnquiries,
      needsAttention,
    };
  }, [accessibleListings, ownerEnquiries]);

  // Create New Listing Template
  const handleStartNewListing = (category: ListingCategory = 'business') => {
    const id = `${category.slice(0, 3)}-${Date.now()}`;
    const newListing: Listing = {
      id,
      title: '',
      category,
      subcategory:
        category === 'real_estate'
          ? 'Residential Property'
          : category === 'business'
            ? 'Local Retail & Services'
            : 'Community Facility',
      status: 'draft',
      verificationStatus: 'unverified_sample',
      description: '',
      shortDescription: '',
      locality: 'New Lamka, Churachandpur',
      address: 'Tedim Road, New Lamka, Churachandpur',
      coordinates: { lat: 24.3335, lng: 93.6978 },
      contactPhone: '+91 98620 00000',
      contactEmail: currentUser.email,
      coverImage: generateCoverImageDataUri(
        'New Sample Listing',
        category,
        'New Lamka',
        1
      ),
      galleryImages: [
        generateCoverImageDataUri(
          'New Sample Listing — Exterior',
          category,
          'New Lamka',
          2
        ),
      ],
      ownerId: currentUser.roleType === 'owner' ? currentUser.id : 'owner-1',
      ownerName:
        currentUser.roleType === 'owner' ? currentUser.name : 'Zorinpuia Sailo',
      assignedStaffIds: [],
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
      isFeaturedDemo: false,
      rating: 4.5,
      reviewCount: 0,
      viewsCount: 0,
      mapImpressionsCount: 0,
      detailVisitsCount: 0,
      directionClicksCount: 0,
      followsCount: 0,
      enquiriesCount: 0,
      versionHistory: [],
      businessDetails:
        category === 'business'
          ? {
              subcategory: 'Retail & Supplies',
              openingHours: 'Mon–Sat: 09:00 AM – 07:00 PM',
              priceRange: '₹₹',
              deliveryInfo: 'Local delivery available in Churachandpur',
              establishedYear: 2021,
              highlights: ['Sample Business', 'Verified Demo'],
              catalogue: [],
            }
          : undefined,
      realEstateDetails:
        category === 'real_estate'
          ? {
              propertyType: 'house_with_plot',
              hasAssociatedPlot: true,
              availability: 'available',
              askingPrice: 4500000,
              priceLabel: '₹45.0 Lakhs (Sample)',
              builtUpAreaSqm: 165,
              plotAreaSqm: 280,
              bedrooms: 3,
              bathrooms: 2,
              floors: 2,
              furnishingStatus: 'Semi-Furnished',
              roadFrontageMeters: 12,
              utilities: ['Grid Electricity', 'Water Tank'],
              amenities: ['Parking', 'Fenced Compound'],
              boundaryPolygon: [
                { lat: 24.3338, lng: 93.6975 },
                { lat: 24.3338, lng: 93.6981 },
                { lat: 24.3333, lng: 93.6981 },
                { lat: 24.3333, lng: 93.6975 },
              ],
              panoramas: [],
              streetViewAvailable: false,
            }
          : undefined,
      serviceDetails:
        category === 'service'
          ? {
              serviceType: 'Professional & Technical Service',
              areasServed: ['New Lamka', 'Tuibong', 'Rengkai'],
              workingHours: '09:00 AM – 06:00 PM',
              availabilityStatus: 'Available Today',
              startingPrice: 300,
              priceRangeText: '₹300 – ₹2,500 (Sample)',
              experienceYears: 5,
              workSamples: ['Sample Residential Project'],
              certificationsLabel: 'Sample Trade Certificate',
            }
          : undefined,
      publicPlaceDetails:
        category === 'public_place'
          ? {
              placeType: 'Community Landmark',
              publicInfo: 'Open to community visitors',
              facilities: ['Seating', 'Drinking Water'],
              openingHours: '06:00 AM – 06:00 PM',
              verificationSourceLabel: 'District Community Board (Sample)',
              accessibilityNotes: 'Ramp access available at main gate',
            }
          : undefined,
      sportsDetails:
        category === 'sports'
          ? {
              sportActivity: 'Football & Futsal',
              venueCategory: 'Turf Court',
              facilities: ['Floodlights', 'Changing Rooms'],
              capacity: 150,
              openingHours: '06:00 AM – 10:00 PM',
              surfaceType: 'FIFA-Grade Synthetic Turf',
              accessNotes: 'Slot enquiry available via demonstration form',
            }
          : undefined,
    };

    setEditorError(null);
    setEditorSection('basics');
    setEditingListing(newListing);
  };

  const handleOpenEditListing = useCallback(
    (listing: Listing) => {
      if (isStaffMode && !hasStaffPermission(listing.id, 'edit_details')) {
        setStatusBanner({
          type: 'error',
          text: 'Delegated Staff Restriction: You do not have "Edit Listing Details" permission for this listing.',
        });
        return;
      }
      setEditorError(null);
      setEditorSection('basics');
      setEditingListing(JSON.parse(JSON.stringify(listing)));
    },
    [isStaffMode, hasStaffPermission]
  );

  // Switch category inside editor
  const handleEditorCategoryChange = (nextCategory: ListingCategory) => {
    if (!editingListing) return;
    setEditingListing(applyEditorCategoryChange(editingListing, nextCategory));
  };

  // Handle Property Type change with conditional plot/boundary rule
  const handlePropertyTypeChange = (
    nextType: PropertyType,
    commercialHasPlot?: boolean
  ) => {
    if (!editingListing || !editingListing.realEstateDetails) return;
    setEditingListing(
      applyEditorPropertyTypeChange(
        editingListing,
        nextType,
        commercialHasPlot
      )
    );
  };

  // Add valid 2:1 synthetic equirectangular 360° panorama
  const handleAddValidPanorama = () => {
    if (!editingListing || !editingListing.realEstateDetails) return;
    const existing = editingListing.realEstateDetails.panoramas || [];
    const index = existing.length + 1;
    const name = newPanoramaName.trim() || `Panorama ${index}`;
    const newScene: PanoramaScene = {
      id: `pano-${Date.now()}`,
      name,
      imageUrl: generateEquirectangularPanoramaDataUri(
        editingListing.title || 'Sample Property',
        name,
        editingListing.locality,
        index
      ),
      width: 2048,
      height: 1024,
      isEquirectangular: true,
      isSyntheticDemo: true,
      isPrimary: existing.length === 0,
      order: index,
      initialYaw: 0,
      initialPitch: 0,
    };

    const check = validatePanoramaScene(newScene);
    if (!check.valid) {
      setEditorError(check.reason || 'Invalid panorama scene.');
      return;
    }

    setEditorError(null);
    setEditingListing({
      ...editingListing,
      realEstateDetails: {
        ...editingListing.realEstateDetails,
        panoramas: [...existing, newScene],
      },
    });
    setNewPanoramaName(`Panorama ${index + 1}`);
  };

  // Simulate attempting to upload a standard 4:3 photo as a 360° panorama (demonstrates rejection rule)
  const handleAttemptInvalidStandardPhotoAsPanorama = () => {
    const invalidCandidate = {
      name: 'Standard 4:3 Camera Photo.jpg',
      imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      width: 1600,
      height: 1200, // 4:3 aspect ratio (1.33), NOT 2:1 equirectangular
      isEquirectangular: false,
    };
    const validation = validatePanoramaScene(invalidCandidate);
    if (!validation.valid) {
      setEditorError(
        `360° Panorama Validation Rejected: ${validation.reason}`
      );
    }
  };

  // Save or Submit Listing
  const handleSaveEditorListing = (targetStatus: ListingStatus) => {
    if (!editingListing) return;
    if (!editingListing.title.trim()) {
      setEditorError('Listing title is required.');
      setEditorSection('basics');
      return;
    }

    const res = saveListing(editingListing, targetStatus);
    if (!res.ok) {
      setEditorError(res.message);
      setEditorSection('media');
      return;
    }

    // Phase 3-C: Sync create/update with Supabase listings service under RLS ownerId
    const existsAlready = listings.some((l) => l.id === editingListing.id);
    if (existsAlready) {
      void updateListing(
        editingListing.id,
        { ...editingListing, status: targetStatus },
        effectiveOwnerId
      ).catch(() => {
        // Local store already updated when Supabase is offline/unconfigured
      });
    } else {
      void createListing(
        { ...editingListing, status: targetStatus },
        effectiveOwnerId
      ).catch(() => {
        // Local store already updated when Supabase is offline/unconfigured
      });
    }

    setStatusBanner({ type: 'success', text: res.message });
    setEditingListing(null);
  };

  // Phase 3-C: Create New Listing placeholder workflow utilizing createListing()
  const handleCreateNewListingViaSupabase = async () => {
    setIsCreatingSupabaseListing(true);
    const draftId = `biz-${Date.now()}`;
    const placeholderDraft: Listing = {
      id: draftId,
      title: `New Churachandpur Listing (${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })})`,
      category: 'business',
      subcategory: 'Local Retail & Services',
      status: 'draft',
      verificationStatus: 'unverified_sample',
      description:
        'Draft listing initialized via Supabase createListing service.',
      shortDescription: 'Draft listing created from Owner Workspace.',
      locality: 'New Lamka',
      address: 'Tedim Road, New Lamka, Churachandpur',
      coordinates: { lat: 24.3335, lng: 93.6978 },
      contactPhone: '+91 98620 00000',
      contactEmail: authUser?.email || currentUser.email,
      coverImage: generateCoverImageDataUri(
        'New Listing Draft',
        'business',
        'New Lamka',
        1
      ),
      galleryImages: [],
      ownerId: effectiveOwnerId,
      ownerName: authUser?.email || currentUser.name,
      assignedStaffIds: [],
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
      isFeaturedDemo: false,
      rating: 4.5,
      reviewCount: 0,
      viewsCount: 0,
      mapImpressionsCount: 0,
      detailVisitsCount: 0,
      directionClicksCount: 0,
      followsCount: 0,
      enquiriesCount: 0,
      versionHistory: [],
      businessDetails: {
        subcategory: 'Local Retail & Services',
        openingHours: 'Mon–Sat: 09:00 AM – 07:00 PM',
        priceRange: '₹₹',
        deliveryInfo: 'Local delivery available in Churachandpur',
        establishedYear: 2026,
        highlights: ['Owner Workspace Draft'],
        catalogue: [],
      },
    };

    try {
      const created = await createListing(placeholderDraft, effectiveOwnerId);
      saveListing(created, 'draft');
      setSupabaseOwnerListings((prev) => [
        created,
        ...prev.filter((item) => item.id !== created.id),
      ]);
      setActiveTab('listings');
      setEditingListing(created);
      setStatusBanner({
        type: 'success',
        text: `Created new draft listing "${created.title}" under owner ID ${effectiveOwnerId}.`,
      });
    } catch {
      saveListing(placeholderDraft, 'draft');
      setActiveTab('listings');
      setEditingListing(placeholderDraft);
      setStatusBanner({
        type: 'info',
        text: `Initialized new draft listing "${placeholderDraft.title}" locally (Supabase table not yet provisioned).`,
      });
    } finally {
      setIsCreatingSupabaseListing(false);
    }
  };

  const handleDeleteListingViaSupabase = async (listingId: string) => {
    try {
      await deleteListing(listingId, effectiveOwnerId);
      setSupabaseOwnerListings((prev) =>
        prev.filter((item) => item.id !== listingId)
      );
    } catch {
      // Ignore if offline
    }
  };
  void handleDeleteListingViaSupabase;

  // Handle File Upload for XLSX/CSV Import
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await parseAndValidateListingImportFile(
        file,
        listings,
        currentUser.roleType === 'owner' ? currentUser.id : 'owner-1',
        currentUser.roleType === 'owner' ? currentUser.name : 'Zorinpuia Sailo'
      );
      setImportResult(result);
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: `Failed to parse spreadsheet: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  const handleConfirmImport = () => {
    if (!importResult || importResult.validListings.length === 0) return;
    const outcome = importListingsBatch(importResult.validListings);
    setStatusBanner({
      type: 'success',
      text: `Imported ${outcome.imported} listings into local prototype (${outcome.draftsWithoutPanorama} real-estate items saved as Draft until a valid 360° panorama is added).`,
    });
    setImportResult(null);
    setIsImportModalOpen(false);
  };

  // DataTable Columns for Listings
  const listingColumns = useMemo<DataColumn<Listing>[]>(
    () => [
      {
        id: 'title',
        header: 'Listing Title',
        accessor: (row) => row.title,
        render: (row) => (
          <div>
            <div className="font-semibold text-[var(--ps-text)]">
              {row.title}
            </div>
            <div className="text-xs text-[var(--ps-text-muted)]">
              {row.locality} • ID: {row.id}
            </div>
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        accessor: (row) => CATEGORY_LABELS[row.category],
        render: (row) => (
          <span className="inline-flex items-center rounded border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-xs font-medium text-[var(--ps-text-muted)]">
            {CATEGORY_LABELS[row.category]}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (row) => row.status,
        render: (row) => {
          const colors: Record<ListingStatus, string> = {
            published:
              'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
            draft:
              'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
            submitted:
              'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
            pending_verification:
              'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
            changes_requested:
              'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
            rejected:
              'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
            suspended:
              'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
            archived:
              'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
            expired:
              'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
          };
          return (
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold capitalize ${colors[row.status]}`}
            >
              {row.status.replace(/_/g, ' ')}
            </span>
          );
        },
      },
      {
        id: 'completeness',
        header: 'Completeness & 360°',
        accessor: (row) => calculateListingCompleteness(row).score,
        render: (row) => <CompletenessIndicator listing={row} compact />,
      },
      {
        id: 'views',
        header: 'Views / Enquiries',
        accessor: (row) => row.viewsCount,
        align: 'right',
        render: (row) => (
          <div className="font-mono text-xs">
            <div>{row.viewsCount.toLocaleString('en-IN')} views</div>
            <div className="text-[var(--ps-text-muted)]">
              {row.enquiriesCount} enquiries
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        accessor: (row) => row.id,
        align: 'right',
        render: (row) => (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => handleOpenEditListing(row)}
              className="inline-flex items-center gap-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              title="Edit Listing"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setPreviewListing(row)}
              className="inline-flex items-center gap-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs font-medium text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
              title="Preview Public Page"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid={`owner-locate-on-map-${row.id}`}
              aria-label={`Locate ${row.title} on Discovery Map`}
              onClick={() => onOpenListingOnMap(row.id)}
              className="inline-flex items-center gap-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs font-medium text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
              title="Locate on Discovery Map"
            >
              <MapPin className="h-3.5 w-3.5" />
            </button>
            {!isStaffMode && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const copy = duplicateListing(row.id);
                    if (copy) {
                      setStatusBanner({
                        type: 'info',
                        text: `Created draft duplicate "${copy.title}".`,
                      });
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs font-medium text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                  title="Duplicate as Draft"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    changeListingStatus(row.id, 'archived');
                    setStatusBanner({
                      type: 'info',
                      text: `Archived "${row.title}".`,
                    });
                  }}
                  className="inline-flex items-center gap-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10"
                  title="Archive Listing"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ),
      },
    ],
    [
      isStaffMode,
      handleOpenEditListing,
      duplicateListing,
      changeListingStatus,
      onOpenListingOnMap,
    ]
  );

  // Selected Business for Catalogue Management
  const selectedCatalogueBusiness = useMemo(
    () =>
      businessListings.find((b) => b.id === selectedCatalogueBizId) ||
      businessListings[0] ||
      null,
    [businessListings, selectedCatalogueBizId]
  );

  const filteredCatalogueProducts = useMemo(() => {
    const items = selectedCatalogueBusiness?.businessDetails?.catalogue || [];
    if (!catalogueSearch.trim()) return items;
    const q = catalogueSearch.toLowerCase();
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [selectedCatalogueBusiness, catalogueSearch]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      {/* Workspace Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-[var(--ps-border)] pb-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[var(--ps-surface-alt)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              {isStaffMode
                ? 'Staff / Agent Delegated Workspace'
                : 'Listing Owner Workspace'}
            </span>
            <span className="text-xs text-[var(--ps-text-muted)]">
              Active Account:{' '}
              <strong className="text-[var(--ps-text)]">
                {currentUser.name}
              </strong>{' '}
              ({currentUser.email})
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--ps-text)]">
            {isStaffMode
              ? 'Assigned Listings & Delegated Operations'
              : 'Portfolio, 360° Property Media & Business Catalogues'}
          </h1>
          <p className="mt-1 text-sm text-[var(--ps-text-muted)]">
            {isStaffMode
              ? 'Your workspace is strictly scoped to listings and permissions delegated by the listing owner.'
              : 'Manage multi-category listings, enforce real-estate 360° equirectangular panoramas, update product catalogues, and respond to sample enquiries.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!isStaffMode && (
            <>
              <button
                type="button"
                onClick={() => {
                  setImportResult(null);
                  setIsImportModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] shadow-xs hover:bg-[var(--ps-surface-alt)]"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Import XLSX / CSV
              </button>
              <button
                type="button"
                onClick={() => handleStartNewListing('real_estate')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] shadow-xs hover:bg-[var(--ps-surface-alt)]"
              >
                <Compass className="h-4 w-4 text-[var(--ps-accent)]" />
                + New Real-Estate (360°)
              </button>
              <button
                type="button"
                disabled={isCreatingSupabaseListing}
                onClick={() => {
                  void handleCreateNewListingViaSupabase();
                }}
                data-testid="create-new-listing-btn"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                <span>
                  {isCreatingSupabaseListing
                    ? 'Creating…'
                    : 'Create New Listing'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Synthetic Performance Analytics Widget */}
      <AnalyticsWidget
        mapImpressions={kpis.mapImpressions}
        detailVisits={kpis.detailVisits}
        whatsappClicks={accessibleListings.reduce(
          (sum, l) => sum + (l.directionClicksCount || 0) + l.enquiriesCount,
          0
        )}
        className="mb-6"
      />

      {/* Staff Permission Scope Banner */}
      {isStaffMode && (
        <div className="mb-6 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">
                Active Staff Delegation Scope ({accessibleListings.length}{' '}
                Assigned Listings)
              </h2>
              <p className="mt-0.5 text-xs text-indigo-800/90 dark:text-indigo-300">
                You can only view and act upon listings explicitly assigned to your staff profile. Unassigned listings and owner-level billing/delegation settings are restricted.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {staffDelegations
                .filter(
                  (d) =>
                    d.staffUserId === currentUser.id && d.status === 'active'
                )
                .flatMap((d) => d.permissions)
                .map((perm) => (
                  <span
                    key={perm}
                    className="rounded border border-indigo-500/30 bg-[var(--ps-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ps-text)]"
                  >
                    ✓ {perm.replace(/_/g, ' ')}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Status Notification Toast/Banner */}
      {statusBanner && (
        <div
          className={`mb-5 flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            statusBanner.type === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
              : statusBanner.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                : 'border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="ml-4 rounded p-1 hover:bg-black/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs (Horizontally scrollable on mobile, wraps cleanly on desktop) */}
      <nav
        aria-label="Owner and staff workspace sections"
        className="mb-6 flex overflow-x-auto whitespace-nowrap lg:flex-wrap gap-1.5 border-b border-[var(--ps-border)] pb-3"
      >
        {[
          { id: 'overview', label: 'Dashboard Overview', icon: Layers },
          {
            id: 'listings',
            label: `Listings (${accessibleListings.length})`,
            icon: Building2,
          },
          {
            id: 'catalogues',
            label: `Product Catalogues (${businessListings.length})`,
            icon: Package,
          },
          {
            id: 'enquiries',
            label: `Enquiry Centre (${ownerEnquiries.length})`,
            icon: Inbox,
          },
          {
            id: 'reviews',
            label: `Reviews & Replies (${ownerReviews.length})`,
            icon: MessageSquare,
          },
          { id: 'analytics', label: 'Owner Analytics', icon: BarChart3 },
          ...(!isStaffMode
            ? [{ id: 'staff', label: 'Staff & Delegation', icon: Users }]
            : []),
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as OwnerTab)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                  : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Primary KPI Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
              <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                Total Listings
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--ps-text)]">
                {kpis.total}
              </div>
              <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                {kpis.published} published live
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
              <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                Drafts & Pending
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--ps-text)]">
                {kpis.draft + kpis.submitted}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                {kpis.draft} draft • {kpis.submitted} submitted
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
              <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                Changes / Archived
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-amber-600 dark:text-amber-400">
                {kpis.changesRequested}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                {kpis.archivedOrSuspended} archived/suspended
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
              <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                Total Views
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--ps-text)]">
                {kpis.views.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                {kpis.mapImpressions.toLocaleString('en-IN')} map impressions
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
              <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                Detail Visits & Saves
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--ps-text)]">
                {kpis.detailVisits.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                {kpis.follows.toLocaleString('en-IN')} visitor saves
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
              <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                Open Enquiries
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[var(--ps-accent)]">
                {kpis.openEnquiries}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                {ownerReviews.length} total reviews
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Items Needing Attention */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Items Needing Attention ({kpis.needsAttention.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('listings')}
                  className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  View All Listings →
                </button>
              </div>
              {kpis.needsAttention.length === 0 ? (
                <p className="text-sm text-[var(--ps-text-muted)]">
                  All accessible listings have high completeness scores and valid required media.
                </p>
              ) : (
                <div className="divide-y divide-[var(--ps-border)]">
                  {kpis.needsAttention.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--ps-text)]">
                            {item.title}
                          </span>
                          <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-medium text-[var(--ps-text-muted)]">
                            {item.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {item.changeRequestNote && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Moderator Note: {item.changeRequestNote}
                          </p>
                        )}
                        <CompletenessIndicator listing={item} />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenEditListing(item)}
                        className="shrink-0 self-start rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] sm:self-center"
                      >
                        Resolve in Editor
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Notifications */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
              <h2 className="mb-3 text-base font-bold text-[var(--ps-text)]">
                Recent Workspace Notifications
              </h2>
              <div className="space-y-2.5">
                {notifications.slice(0, 5).map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => markNotificationRead(notif.id)}
                    className={`cursor-pointer rounded-lg border p-3 transition ${
                      notif.read
                        ? 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50'
                        : 'border-[var(--ps-accent)]/40 bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        {notif.title}
                      </span>
                      {!notif.read && (
                        <span className="h-2 w-2 rounded-full bg-[var(--ps-accent)]" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                      {notif.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LISTINGS TABLE */}
      {activeTab === 'listings' && (
        <DataTable
          title="Managed Listings Portfolio"
          subtitle="Create, edit, duplicate, archive, or export listings. Real-estate listings enforce mandatory 360° equirectangular panoramas before submission."
          data={accessibleListings}
          columns={listingColumns}
          rowKey={(r) => r.id}
          exportFilename="printswift-owner-listings"
          searchPlaceholder="Search by title, locality, category, or status..."
        />
      )}

      {/* TAB 3: BUSINESS PRODUCT CATALOGUES */}
      {activeTab === 'catalogues' && (
        <div className="space-y-5">
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Select Business Listing to Manage Catalogue
              </label>
              <select
                value={selectedCatalogueBusiness?.id || ''}
                onChange={(e) => setSelectedCatalogueBizId(e.target.value)}
                className="mt-1.5 w-full max-w-md rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm font-semibold text-[var(--ps-text)]"
              >
                {businessListings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.locality}) —{' '}
                    {b.businessDetails?.catalogue.length || 0} Products
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={catalogueSearch}
                onChange={(e) => setCatalogueSearch(e.target.value)}
                placeholder="Search products..."
                className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
              />
              <button
                type="button"
                onClick={() => {
                  if (!selectedCatalogueBusiness) return;
                  if (
                    isStaffMode &&
                    !hasStaffPermission(
                      selectedCatalogueBusiness.id,
                      'manage_catalogue'
                    )
                  ) {
                    setStatusBanner({
                      type: 'error',
                      text: 'Delegated Staff Restriction: Missing "manage_catalogue" permission.',
                    });
                    return;
                  }
                  setEditingProduct({
                    id: `prod-${Date.now()}`,
                    listingId: selectedCatalogueBusiness.id,
                    name: '',
                    category: 'General Merchandise',
                    price: 450,
                    variants: ['Standard'],
                    availability: 'in_stock',
                    description: '',
                    imageUrl: generateProductImageDataUri(
                      'New Sample Item',
                      'General',
                      450
                    ),
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
              >
                <Plus className="h-4 w-4" />
                Add Product
              </button>
            </div>
          </div>

          {/* Product Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCatalogueProducts.map((prod) => (
              <div
                key={prod.id}
                className="flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 shadow-xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        {prod.category}
                      </span>
                      <h3 className="mt-0.5 text-sm font-bold text-[var(--ps-text)]">
                        {prod.name}
                      </h3>
                    </div>
                    <span className="font-mono text-sm font-bold text-[var(--ps-accent)]">
                      ₹{prod.price.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--ps-text-muted)]">
                    {prod.description}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-[var(--ps-border)] pt-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                      prod.availability === 'in_stock'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : prod.availability === 'made_to_order'
                          ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {prod.availability.replace(/_/g, ' ')}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingProduct({ ...prod })}
                      className="rounded border border-[var(--ps-border)] px-2 py-1 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedCatalogueBusiness) return;
                        saveCatalogueProduct(selectedCatalogueBusiness.id, {
                          ...prod,
                          id: `prod-copy-${Date.now()}`,
                          name: `${prod.name} (Copy)`,
                        });
                      }}
                      className="rounded border border-[var(--ps-border)] px-2 py-1 text-xs font-medium text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedCatalogueBusiness) return;
                        deleteCatalogueProduct(
                          selectedCatalogueBusiness.id,
                          prod.id
                        );
                      }}
                      className="rounded border border-rose-500/30 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Product Modal */}
          {editingProduct && selectedCatalogueBusiness && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--ps-text)]">
                    {editingProduct.name
                      ? 'Edit Product'
                      : 'New Catalogue Product'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="rounded p-1 text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Product Name
                    </label>
                    <input
                      type="text"
                      value={editingProduct.name}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          name: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                        Category
                      </label>
                      <input
                        type="text"
                        value={editingProduct.category}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            category: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                        Price (INR)
                      </label>
                      <input
                        type="number"
                        value={editingProduct.price}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            price: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Availability
                    </label>
                    <select
                      value={editingProduct.availability}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          availability: e.target
                            .value as CatalogueProduct['availability'],
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    >
                      <option value="in_stock">In Stock</option>
                      <option value="low_stock">Low Stock</option>
                      <option value="made_to_order">Made to Order</option>
                      <option value="out_of_stock">Out of Stock</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Description
                    </label>
                    <textarea
                      rows={3}
                      value={editingProduct.description}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          description: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingProduct(null)}
                    className="rounded-lg border border-[var(--ps-border)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!editingProduct.name.trim()) return;
                      saveCatalogueProduct(selectedCatalogueBusiness.id, {
                        ...editingProduct,
                        imageUrl: generateProductImageDataUri(
                          editingProduct.name,
                          editingProduct.category,
                          editingProduct.price
                        ),
                      });
                      setEditingProduct(null);
                      setStatusBanner({
                        type: 'success',
                        text: `Saved product "${editingProduct.name}" to ${selectedCatalogueBusiness.title}.`,
                      });
                    }}
                    className="rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
                  >
                    Save Product
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ENQUIRY CENTRE */}
      {activeTab === 'enquiries' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                Enquiry Inbox ({ownerEnquiries.length})
              </h2>
              <select
                value={enquiryStatusFilter}
                onChange={(e) => setEnquiryStatusFilter(e.target.value)}
                className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs"
              >
                <option value="all">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="space-y-2">
              {ownerEnquiries
                .filter(
                  (e) =>
                    enquiryStatusFilter === 'all' ||
                    e.status === enquiryStatusFilter
                )
                .map((enq) => (
                  <button
                    key={enq.id}
                    type="button"
                    onClick={() => {
                      setSelectedEnquiryId(enq.id);
                      setEnquiryReplyDraft(enq.ownerReply || '');
                    }}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      selectedEnquiryId === enq.id
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        {enq.senderName}
                      </span>
                      <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-semibold uppercase">
                        {enq.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-[var(--ps-accent)]">
                      {enq.listingTitle}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--ps-text-muted)]">
                      {enq.message}
                    </p>
                  </button>
                ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 lg:col-span-2">
            {(() => {
              const activeEnq =
                ownerEnquiries.find((e) => e.id === selectedEnquiryId) ||
                ownerEnquiries[0];
              if (!activeEnq) {
                return (
                  <p className="text-sm text-[var(--ps-text-muted)]">
                    No enquiries available for your listings.
                  </p>
                );
              }
              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--ps-border)] pb-4">
                    <div>
                      <span className="text-xs font-semibold uppercase text-[var(--ps-text-muted)]">
                        Enquiry on {activeEnq.listingTitle} ({activeEnq.source})
                      </span>
                      <h3 className="text-lg font-bold text-[var(--ps-text)]">
                        From: {activeEnq.senderName} ({activeEnq.senderPhone})
                      </h3>
                    </div>
                    <div className="flex gap-1.5">
                      {(['open', 'in_progress', 'resolved'] as const).map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() =>
                              replyToEnquiry(
                                activeEnq.id,
                                enquiryReplyDraft || activeEnq.ownerReply || '',
                                st
                              )
                            }
                            className={`rounded border px-2.5 py-1 text-xs font-semibold capitalize ${
                              activeEnq.status === st
                                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                            }`}
                          >
                            {st.replace(/_/g, ' ')}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 text-sm text-[var(--ps-text)]">
                    {activeEnq.message}
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Demonstration Reply (Stored Locally)
                    </label>
                    <textarea
                      rows={3}
                      value={enquiryReplyDraft}
                      onChange={(e) => setEnquiryReplyDraft(e.target.value)}
                      placeholder="Write a helpful response to this demonstration enquiry..."
                      className="mt-1.5 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-sm text-[var(--ps-text)]"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          replyToEnquiry(
                            activeEnq.id,
                            enquiryReplyDraft,
                            'resolved'
                          );
                          setStatusBanner({
                            type: 'success',
                            text: 'Saved demonstration reply and marked enquiry as resolved.',
                          });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Save Reply & Mark Resolved
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-[var(--ps-border)] pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Enquiry Activity Log
                    </h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-[var(--ps-text-muted)]">
                      {activeEnq.activityLog.map((log) => (
                        <li key={log.id}>
                          <strong className="text-[var(--ps-text)]">
                            {log.actor}
                          </strong>
                          : {log.action} (
                          {log.timestamp.replace('T', ' ').slice(0, 19)} UTC)
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB 5: REVIEWS & REPLIES */}
      {activeTab === 'reviews' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <p className="text-xs text-[var(--ps-text-muted)]">
              <strong>Owner Review Integrity Rule:</strong> Listing owners and delegated staff can post or update an official Owner Reply or flag a review for moderator attention, but can never alter or delete the visitor&apos;s original review text.
            </p>
          </div>
          {ownerReviews.map((rev) => (
            <div
              key={rev.id}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-[var(--ps-accent)]">
                    {rev.listingTitle}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--ps-text)]">
                      {rev.authorName}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-500">
                      <Star className="h-3.5 w-3.5 fill-amber-400" />
                      {rev.rating}.0
                    </span>
                    <span className="text-xs text-[var(--ps-text-muted)]">
                      • {rev.createdAt}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    reportReview(
                      rev.id,
                      'Reported by owner for moderation review'
                    );
                    setStatusBanner({
                      type: 'info',
                      text: 'Review flagged for Admin Moderation Centre.',
                    });
                  }}
                  className="rounded border border-[var(--ps-border)] px-2.5 py-1 text-xs font-medium text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                >
                  {rev.reported ? 'Flagged for Moderation' : 'Report Review'}
                </button>
              </div>

              <p className="mt-2 rounded-lg bg-[var(--ps-surface-alt)] p-3 text-sm text-[var(--ps-text)]">
                &ldquo;{rev.comment}&rdquo;
              </p>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={
                    reviewReplyDrafts[rev.id] !== undefined
                      ? reviewReplyDrafts[rev.id]
                      : rev.ownerReply || ''
                  }
                  onChange={(e) =>
                    setReviewReplyDrafts({
                      ...reviewReplyDrafts,
                      [rev.id]: e.target.value,
                    })
                  }
                  placeholder="Write or update official Owner Reply..."
                  className="flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const text =
                      reviewReplyDrafts[rev.id] ?? rev.ownerReply ?? '';
                    replyToReview(rev.id, text);
                    setStatusBanner({
                      type: 'success',
                      text: 'Owner reply saved.',
                    });
                  }}
                  className="rounded-lg bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  Save Owner Reply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 6: OWNER ANALYTICS */}
      {activeTab === 'analytics' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div>
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Portfolio Performance Analytics (Sample Telemetry)
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Clear metric definitions: Map Impressions = viewport pin loads • Detail Visits = side card or full page opens • Direction Clicks = route/coordinate copies.
              </p>
            </div>
            <div className="flex gap-1.5">
              {(['7d', '30d', '90d'] as const).map((rng) => (
                <button
                  key={rng}
                  type="button"
                  onClick={() => setAnalyticsRange(rng)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    analyticsRange === rng
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  Last {rng.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <DataTable
            title="Per-Listing Conversion & Engagement"
            data={accessibleListings}
            rowKey={(r) => r.id}
            exportFilename={`owner-analytics-${analyticsRange}`}
            columns={[
              {
                id: 'title',
                header: 'Listing',
                accessor: (r) => r.title,
              },
              {
                id: 'category',
                header: 'Category',
                accessor: (r) => CATEGORY_LABELS[r.category],
              },
              {
                id: 'impressions',
                header: 'Map Impressions',
                accessor: (r) => r.mapImpressionsCount,
                align: 'right',
              },
              {
                id: 'views',
                header: 'Total Views',
                accessor: (r) => r.viewsCount,
                align: 'right',
              },
              {
                id: 'detailVisits',
                header: 'Detail Visits',
                accessor: (r) => r.detailVisitsCount,
                align: 'right',
              },
              {
                id: 'directions',
                header: 'Direction Clicks',
                accessor: (r) => r.directionClicksCount,
                align: 'right',
              },
              {
                id: 'enquiries',
                header: 'Enquiries',
                accessor: (r) => r.enquiriesCount,
                align: 'right',
              },
            ]}
          />
        </div>
      )}

      {/* TAB 7: STAFF & DELEGATED MANAGEMENT */}
      {activeTab === 'staff' && !isStaffMode && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Delegate Access to Staff / Agent
            </h2>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Assign specific listings and granular permissions to a staff member or real-estate agent.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Staff / Agent Full Name
                </label>
                <input
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="e.g., Thangminlien Zou"
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Staff Email
                </label>
                <input
                  type="email"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  placeholder="agent@printswift.local.demo"
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Assign Listings ({selectedDelegationListings.length} selected)
                </label>
                <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2">
                  {accessibleListings.map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 text-xs text-[var(--ps-text)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDelegationListings.includes(l.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDelegationListings([
                              ...selectedDelegationListings,
                              l.id,
                            ]);
                          } else {
                            setSelectedDelegationListings(
                              selectedDelegationListings.filter(
                                (id) => id !== l.id
                              )
                            );
                          }
                        }}
                      />
                      <span className="truncate">{l.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Granular Permissions
                </label>
                <div className="mt-1 space-y-1">
                  {ALL_STAFF_PERMISSIONS.map((perm) => (
                    <label
                      key={perm.id}
                      className="flex items-center gap-2 text-xs text-[var(--ps-text)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPermissions.includes(perm.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPermissions([
                              ...selectedPermissions,
                              perm.id,
                            ]);
                          } else {
                            setSelectedPermissions(
                              selectedPermissions.filter((p) => p !== perm.id)
                            );
                          }
                        }}
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!newStaffName.trim()) return;
                  saveStaffDelegation({
                    id: `del-${Date.now()}`,
                    ownerId: currentUser.id,
                    staffUserId: 'staff-1',
                    staffName: newStaffName.trim(),
                    staffEmail:
                      newStaffEmail.trim() || 'staff@printswift.local.demo',
                    assignedListingIds:
                      selectedDelegationListings.length > 0
                        ? selectedDelegationListings
                        : accessibleListings.slice(0, 2).map((l) => l.id),
                    permissions: selectedPermissions,
                    assignedAt: new Date().toISOString().slice(0, 10),
                    status: 'active',
                  });
                  setNewStaffName('');
                  setNewStaffEmail('');
                  setStatusBanner({
                    type: 'success',
                    text: 'Staff delegation saved.',
                  });
                }}
                className="w-full rounded-lg bg-[var(--ps-accent)] py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
              >
                Save Staff Delegation
              </button>
            </div>
          </div>

          <div className="space-y-3 lg:col-span-2">
            {staffDelegations.map((del) => (
              <div
                key={del.id}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--ps-text)]">
                        {del.staffName}
                      </h3>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          del.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                      >
                        {del.status}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      {del.staffEmail} • Assigned{' '}
                      {del.assignedListingIds.length} listings
                    </p>
                  </div>
                  {del.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => revokeStaffDelegation(del.id)}
                      className="rounded border border-rose-500/30 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500/10"
                    >
                      Revoke Access
                    </button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {del.permissions.map((perm) => (
                    <span
                      key={perm}
                      className="rounded border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-medium text-[var(--ps-text-muted)]"
                    >
                      {perm.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LISTING EDITOR MODAL / DRAWER */}
      {editingListing && (
        <div
          data-testid="existing-listing-editor-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
        >
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl">
            {/* Editor Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[var(--ps-accent)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent-fg)]">
                    {CATEGORY_LABELS[editingListing.category]}
                  </span>
                  <span
                    data-testid="editor-status-badge"
                    className="text-xs font-medium text-[var(--ps-text-muted)]"
                  >
                    Status:{' '}
                    <strong>{editingListing.status.replace(/_/g, ' ')}</strong>
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-bold text-[var(--ps-text)]">
                  {editingListing.title || 'Untitled Listing'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setEditingListing(null)}
                data-testid="editor-close-btn"
                className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2 text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Map Geometry Prefill Banner (Shown when launched via "Create Listing Here") */}
            {editingListing.customFields?.sourceGeometryId && (
              <div
                data-testid="editor-geometry-prefill-banner"
                className="border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5 text-xs text-emerald-950 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    Geometry Prefilled:{' '}
                    {String(editingListing.customFields.sourceGeometryType)}
                  </span>
                  <span className="font-semibold">
                    Source: &ldquo;
                    {String(editingListing.customFields.sourceGeometryLabel)}
                    &rdquo; ({editingListing.coordinates.lat.toFixed(5)},{' '}
                    {editingListing.coordinates.lng.toFixed(5)})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  {editingListing.realEstateDetails?.boundaryPolygon &&
                    editingListing.realEstateDetails.boundaryPolygon.length >=
                      3 && (
                      <span
                        data-testid="editor-prefilled-boundary-badge"
                        className="rounded bg-[var(--ps-surface)] px-2 py-0.5 border border-emerald-500/40"
                      >
                        Boundary:{' '}
                        {
                          editingListing.realEstateDetails.boundaryPolygon
                            .length
                        }{' '}
                        vertices · Plot:{' '}
                        {editingListing.realEstateDetails.plotAreaSqm} m²
                      </span>
                    )}
                  {editingListing.customFields
                    .serviceCoverageRadiusMeters !== undefined && (
                    <span
                      data-testid="editor-prefilled-radius-badge"
                      className="rounded bg-[var(--ps-surface)] px-2 py-0.5 border border-emerald-500/40"
                    >
                      Coverage Radius:{' '}
                      {String(
                        editingListing.customFields.serviceCoverageRadiusMeters
                      )}{' '}
                      m
                    </span>
                  )}
                  {editingListing.customFields.routeReference !== undefined && (
                    <span
                      data-testid="editor-prefilled-route-badge"
                      className="rounded bg-[var(--ps-surface)] px-2 py-0.5 border border-emerald-500/40"
                    >
                      {String(editingListing.customFields.routeReference)} (No
                      plot boundary)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Actionable Completeness Strip */}
            {(() => {
              const comp = calculateListingCompleteness(editingListing);
              return (
                <div className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)] px-6 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        Listing Completeness: {comp.score}%
                      </span>
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-[var(--ps-surface-alt)]">
                        <div
                          className="h-full bg-[var(--ps-accent)] transition-all"
                          style={{ width: `${comp.score}%` }}
                        />
                      </div>
                    </div>
                    {comp.missingItems.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-[var(--ps-text-muted)]">
                          Jump to missing:
                        </span>
                        {comp.missingItems.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                              if (
                                item.section === 'panorama' ||
                                item.section === 'media'
                              ) {
                                setEditorSection('media');
                              } else if (item.section === 'category') {
                                setEditorSection('category');
                              } else {
                                setEditorSection('basics');
                              }
                            }}
                            className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                          >
                            + {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Validation Error Banner inside Editor */}
            {editorError && (
              <div
                data-testid="editor-error-banner"
                className="flex items-center justify-between border-b border-rose-500/40 bg-rose-500/10 px-6 py-3 text-xs font-semibold text-rose-800 dark:text-rose-200"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{editorError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorError(null)}
                  className="text-rose-700 underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Section Tabs */}
            <div className="flex gap-4 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-6 pt-3">
              {[
                { id: 'basics', label: '1. Basic & Location Details' },
                {
                  id: 'category',
                  label: `2. ${CATEGORY_LABELS[editingListing.category]} Fields`,
                },
                {
                  id: 'media',
                  label:
                    editingListing.category === 'real_estate'
                      ? '3. Photos & Mandatory 360° Panoramas'
                      : '3. Photos & Gallery Media',
                },
                {
                  id: 'versions',
                  label: `4. Version History (${editingListing.versionHistory.length})`,
                },
              ].map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  data-testid={`editor-tab-${sec.id}`}
                  onClick={() =>
                    setEditorSection(
                      sec.id as 'basics' | 'category' | 'media' | 'versions'
                    )
                  }
                  className={`border-b-2 pb-2.5 text-xs font-bold transition ${
                    editorSection === sec.id
                      ? 'border-[var(--ps-accent)] text-[var(--ps-accent)]'
                      : 'border-transparent text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {sec.label}
                </button>
              ))}
            </div>

            {/* Editor Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {editorSection === 'basics' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Category
                    </label>
                    <select
                      data-testid="editor-category-select"
                      value={editingListing.category}
                      onChange={(e) =>
                        handleEditorCategoryChange(
                          e.target.value as ListingCategory
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    >
                      <option value="business">Businesses & Shops</option>
                      <option value="real_estate">
                        Real Estate (Requires 360°)
                      </option>
                      <option value="public_place">Public Places</option>
                      <option value="service">Services</option>
                      <option value="sports">Sports Venues</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Listing Title *
                    </label>
                    <input
                      type="text"
                      data-testid="editor-title-input"
                      value={editingListing.title}
                      onChange={(e) =>
                        setEditingListing({
                          ...editingListing,
                          title: e.target.value,
                        })
                      }
                      placeholder="e.g., Lamka Valley Residency Plot"
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Locality (Churachandpur)
                    </label>
                    <input
                      type="text"
                      data-testid="editor-locality-input"
                      value={editingListing.locality}
                      onChange={(e) =>
                        setEditingListing({
                          ...editingListing,
                          locality: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Address & Landmark
                    </label>
                    <input
                      type="text"
                      data-testid="editor-address-input"
                      value={editingListing.address}
                      onChange={(e) =>
                        setEditingListing({
                          ...editingListing,
                          address: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      data-testid="editor-lat-input"
                      value={editingListing.coordinates.lat}
                      onChange={(e) =>
                        setEditingListing({
                          ...editingListing,
                          coordinates: {
                            ...editingListing.coordinates,
                            lat: parseFloat(e.target.value) || 24.3335,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-sm text-[var(--ps-text)]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      data-testid="editor-lng-input"
                      value={editingListing.coordinates.lng}
                      onChange={(e) =>
                        setEditingListing({
                          ...editingListing,
                          coordinates: {
                            ...editingListing.coordinates,
                            lng: parseFloat(e.target.value) || 93.6978,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-sm text-[var(--ps-text)]"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Full Description
                    </label>
                    <textarea
                      rows={3}
                      data-testid="editor-description-input"
                      value={editingListing.description}
                      onChange={(e) =>
                        setEditingListing({
                          ...editingListing,
                          description: e.target.value,
                          shortDescription: e.target.value.slice(0, 120),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>
                </div>
              )}

              {editorSection === 'category' && (
                <div className="space-y-5">
                  {editingListing.category === 'real_estate' &&
                    editingListing.realEstateDetails && (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
                          <h3 className="text-sm font-bold text-[var(--ps-text)]">
                            Real-Estate Property Type & Conditional Plot Rules
                          </h3>
                          <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                            Plot area and boundary polygon fields are displayed only for land-bearing property types (Plot / Land, House with Plot, Villa / Bungalow with Land, or Commercial with Plot). Switching to Apartment / Flat, House without Plot, or Room / PG automatically hides and clears plot fields.
                          </p>

                          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Property Type
                              </label>
                              <select
                                data-testid="editor-property-type-select"
                                value={
                                  editingListing.realEstateDetails.propertyType
                                }
                                onChange={(e) =>
                                  handlePropertyTypeChange(
                                    e.target.value as PropertyType,
                                    editingListing.realEstateDetails
                                      ?.hasAssociatedPlot
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm font-semibold text-[var(--ps-text)]"
                              >
                                {(
                                  Object.keys(
                                    PROPERTY_TYPE_LABELS
                                  ) as PropertyType[]
                                ).map((pt) => (
                                  <option key={pt} value={pt}>
                                    {PROPERTY_TYPE_LABELS[pt]}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Price Label
                              </label>
                              <input
                                type="text"
                                value={
                                  editingListing.realEstateDetails.priceLabel
                                }
                                onChange={(e) =>
                                  setEditingListing({
                                    ...editingListing,
                                    realEstateDetails: {
                                      ...editingListing.realEstateDetails!,
                                      priceLabel: e.target.value,
                                    },
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                              />
                            </div>
                          </div>

                          {editingListing.realEstateDetails.propertyType ===
                            'commercial' && (
                            <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-[var(--ps-text)]">
                              <input
                                type="checkbox"
                                checked={Boolean(
                                  editingListing.realEstateDetails
                                    .hasAssociatedPlot
                                )}
                                onChange={(e) =>
                                  handlePropertyTypeChange(
                                    'commercial',
                                    e.target.checked
                                  )
                                }
                              />
                              This Commercial Property includes a dedicated land plot / boundary
                            </label>
                          )}
                        </div>

                        {shouldShowPlotAndBoundary(
                          editingListing.realEstateDetails.propertyType,
                          editingListing.realEstateDetails.hasAssociatedPlot
                        ) ? (
                          <div className="grid grid-cols-1 gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Plot Area (Canonical m²) • Active Display:{' '}
                                {formatAreaValue(
                                  editingListing.realEstateDetails.plotAreaSqm ||
                                    0,
                                  areaUnit
                                )}
                              </label>
                              <input
                                type="number"
                                data-testid="editor-plot-area-input"
                                value={
                                  editingListing.realEstateDetails.plotAreaSqm ||
                                  0
                                }
                                onChange={(e) =>
                                  setEditingListing({
                                    ...editingListing,
                                    realEstateDetails: {
                                      ...editingListing.realEstateDetails!,
                                      plotAreaSqm:
                                        parseFloat(e.target.value) || 0,
                                    },
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-sm text-[var(--ps-text)]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Illustrative Boundary Vertices
                              </label>
                              <div
                                data-testid="editor-boundary-vertices-summary"
                                className="mt-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-xs text-[var(--ps-text-muted)]"
                              >
                                {editingListing.realEstateDetails.boundaryPolygon
                                  ?.length || 0}{' '}
                                polygon vertices configured (Non-cadastral)
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            data-testid="editor-plot-omitted-notice"
                            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200"
                          >
                            <strong>Plot & Boundary Fields Omitted:</strong>{' '}
                            {
                              PROPERTY_TYPE_LABELS[
                                editingListing.realEstateDetails.propertyType
                              ]
                            }{' '}
                            does not include a dedicated land plot. Plot area and boundary polygon fields are hidden and cleared.
                          </div>
                        )}

                        {editingListing.realEstateDetails.propertyType !==
                          'plot_land' && (
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Built-Up Area (m²)
                              </label>
                              <input
                                type="number"
                                value={
                                  editingListing.realEstateDetails
                                    .builtUpAreaSqm || 120
                                }
                                onChange={(e) =>
                                  setEditingListing({
                                    ...editingListing,
                                    realEstateDetails: {
                                      ...editingListing.realEstateDetails!,
                                      builtUpAreaSqm:
                                        parseFloat(e.target.value) || 0,
                                    },
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-sm text-[var(--ps-text)]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Bedrooms
                              </label>
                              <input
                                type="number"
                                value={
                                  editingListing.realEstateDetails.bedrooms || 2
                                }
                                onChange={(e) =>
                                  setEditingListing({
                                    ...editingListing,
                                    realEstateDetails: {
                                      ...editingListing.realEstateDetails!,
                                      bedrooms:
                                        parseInt(e.target.value, 10) || 0,
                                    },
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-sm text-[var(--ps-text)]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                                Bathrooms
                              </label>
                              <input
                                type="number"
                                value={
                                  editingListing.realEstateDetails.bathrooms || 2
                                }
                                onChange={(e) =>
                                  setEditingListing({
                                    ...editingListing,
                                    realEstateDetails: {
                                      ...editingListing.realEstateDetails!,
                                      bathrooms:
                                        parseInt(e.target.value, 10) || 0,
                                    },
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-sm text-[var(--ps-text)]"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {editingListing.category !== 'real_estate' && (
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 text-xs text-[var(--ps-text-muted)]">
                      Category-specific metadata for{' '}
                      <strong>{CATEGORY_LABELS[editingListing.category]}</strong>{' '}
                      is active. Note that 360° panorama fields are never required or shown for Business or non-real-estate listings.
                    </div>
                  )}

                  {/* Dynamic Custom Fields configured by Admin */}
                  <div className="border-t border-[var(--ps-border)] pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Dynamic Category Attributes
                    </h4>
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {dynamicFields
                        .filter((f) => f.category === editingListing.category)
                        .map((field) => (
                          <div key={field.id}>
                            <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                              {field.label} {field.required ? '*' : ''}
                            </label>
                            <input
                              type="text"
                              value={String(
                                editingListing.customFields?.[field.name] || ''
                              )}
                              onChange={(e) =>
                                setEditingListing({
                                  ...editingListing,
                                  customFields: {
                                    ...(editingListing.customFields || {}),
                                    [field.name]: e.target.value,
                                  },
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {editorSection === 'media' && (
                <div className="space-y-6">
                  {/* Real Estate Mandatory 360° Panorama Manager */}
                  {editingListing.category === 'real_estate' &&
                    editingListing.realEstateDetails && (
                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-5">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                          <div>
                            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:text-amber-300">
                              Compulsory Real-Estate Rule
                            </span>
                            <h3 className="mt-1 text-base font-bold text-[var(--ps-text)]">
                              360° Equirectangular Panorama Scenes (
                              {editingListing.realEstateDetails.panoramas.length}
                              )
                            </h3>
                            <p className="text-xs text-[var(--ps-text-muted)]">
                              At least one valid 2:1 equirectangular 360° panorama is required to submit or publish a real-estate listing. Standard 4:3 photos are rejected.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={newPanoramaName}
                              onChange={(e) =>
                                setNewPanoramaName(e.target.value)
                              }
                              placeholder="Scene name (e.g., Panorama 1)"
                              className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs text-[var(--ps-text)]"
                            />
                            <button
                              type="button"
                              onClick={handleAddValidPanorama}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              + Add Valid 2:1 Equirectangular 360°
                            </button>
                            <button
                              type="button"
                              onClick={
                                handleAttemptInvalidStandardPhotoAsPanorama
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200"
                              title="Demonstrate validation rejection when a standard 4:3 photo is uploaded as a 360° panorama"
                            >
                              Test 4:3 Photo Rejection
                            </button>
                          </div>
                        </div>

                        {/* Scene List & Reordering */}
                        {editingListing.realEstateDetails.panoramas.length >
                        0 ? (
                          <div className="mt-4 space-y-4">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {editingListing.realEstateDetails.panoramas.map(
                                (scene, idx) => (
                                  <div
                                    key={scene.id}
                                    className="flex items-center justify-between rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3"
                                  >
                                    <div>
                                      <input
                                        type="text"
                                        value={scene.name}
                                        onChange={(e) => {
                                          const updated =
                                            editingListing.realEstateDetails!.panoramas.map(
                                              (s) =>
                                                s.id === scene.id
                                                  ? {
                                                      ...s,
                                                      name: e.target.value,
                                                    }
                                                  : s
                                            );
                                          setEditingListing({
                                            ...editingListing,
                                            realEstateDetails: {
                                              ...editingListing.realEstateDetails!,
                                              panoramas: updated,
                                            },
                                          });
                                        }}
                                        className="rounded border border-transparent px-1 py-0.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-border)]"
                                      />
                                      <div className="text-[11px] text-[var(--ps-text-muted)]">
                                        {scene.width}×{scene.height} (2:1
                                        Equirectangular){' '}
                                        {scene.isPrimary ? '• Primary' : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const updated =
                                            editingListing.realEstateDetails!.panoramas.map(
                                              (s) => ({
                                                ...s,
                                                isPrimary: s.id === scene.id,
                                              })
                                            );
                                          setEditingListing({
                                            ...editingListing,
                                            realEstateDetails: {
                                              ...editingListing.realEstateDetails!,
                                              panoramas: updated,
                                            },
                                          });
                                        }}
                                        className={`rounded px-2 py-1 text-[10px] font-bold ${
                                          scene.isPrimary
                                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                            : 'border border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                                        }`}
                                      >
                                        {scene.isPrimary
                                          ? 'Primary'
                                          : 'Set Primary'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => {
                                          const arr = [
                                            ...editingListing.realEstateDetails!
                                              .panoramas,
                                          ];
                                          const temp = arr[idx - 1];
                                          arr[idx - 1] = arr[idx];
                                          arr[idx] = temp;
                                          setEditingListing({
                                            ...editingListing,
                                            realEstateDetails: {
                                              ...editingListing.realEstateDetails!,
                                              panoramas: arr.map((p, i) => ({
                                                ...p,
                                                order: i + 1,
                                              })),
                                            },
                                          });
                                        }}
                                        className="rounded p-1 text-[var(--ps-text-muted)] disabled:opacity-30"
                                      >
                                        <ArrowUp className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const filtered =
                                            editingListing.realEstateDetails!.panoramas.filter(
                                              (s) => s.id !== scene.id
                                            );
                                          setEditingListing({
                                            ...editingListing,
                                            realEstateDetails: {
                                              ...editingListing.realEstateDetails!,
                                              panoramas: filtered,
                                            },
                                          });
                                        }}
                                        className="rounded p-1 text-rose-600 hover:bg-rose-500/10"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>

                            {/* Live Interactive 360° Preview inside Editor */}
                            <PanoramaViewer360
                              panoramas={
                                editingListing.realEstateDetails.panoramas
                              }
                              propertyTitle={
                                editingListing.title || 'Draft Property'
                              }
                            />
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-6 text-center">
                            <Compass className="mx-auto h-8 w-8 text-amber-500" />
                            <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
                              No 360° Equirectangular Panorama Attached Yet
                            </p>
                            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                              You can save this listing as an incomplete{' '}
                              <strong>Draft</strong> now, or click{' '}
                              <strong>
                                + Add Valid 2:1 Equirectangular 360°
                              </strong>{' '}
                              above to enable submission and publication.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                  {/* Standard Gallery Photos */}
                  <div>
                    <h4 className="text-sm font-bold text-[var(--ps-text)]">
                      Standard Cover & Gallery Images (
                      {editingListing.galleryImages.length})
                    </h4>
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {editingListing.galleryImages.map((img, i) => (
                        <div
                          key={i}
                          className="overflow-hidden rounded-lg border border-[var(--ps-border)]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img}
                            alt={`Gallery ${i + 1}`}
                            className="h-28 w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {editorSection === 'versions' && (
                <div className="space-y-3">
                  {editingListing.versionHistory.length === 0 ? (
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      No saved version snapshots yet.
                    </p>
                  ) : (
                    editingListing.versionHistory.map((ver) => (
                      <div
                        key={ver.versionId}
                        className="flex items-center justify-between rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
                      >
                        <div>
                          <div className="text-xs font-bold text-[var(--ps-text)]">
                            {ver.summary} — {ver.title}
                          </div>
                          <div className="text-[11px] text-[var(--ps-text-muted)]">
                            Edited by {ver.editorName} ({ver.editorRole}) on{' '}
                            {ver.timestamp.replace('T', ' ').slice(0, 19)} UTC
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            restoreListingVersion(
                              editingListing.id,
                              ver.versionId
                            );
                            setEditingListing(null);
                            setStatusBanner({
                              type: 'info',
                              text: `Restored version snapshot "${ver.versionId}".`,
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded border border-[var(--ps-border)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <History className="h-3.5 w-3.5" />
                          Restore Version
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Editor Footer Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-6 py-4">
              <div className="text-xs text-[var(--ps-text-muted)]">
                {editingListing.category === 'real_estate'
                  ? 'Real-estate rule: Drafts allowed without 360°; submission/publication requires >=1 valid 2:1 panorama.'
                  : 'Changes update your local browser session immediately.'}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingListing(null)}
                  data-testid="editor-cancel-btn"
                  className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEditorListing('draft')}
                  data-testid="editor-save-draft-btn"
                  className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-2 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-bg)]"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEditorListing('submitted')}
                  data-testid="editor-submit-verification-btn"
                  className="rounded-lg border border-[var(--ps-accent)] bg-[var(--ps-surface)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent)]"
                >
                  Submit for Verification
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEditorListing('published')}
                  data-testid="editor-publish-btn"
                  className="rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  Publish Listing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* XLSX / CSV IMPORT MODAL */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-4">
              <div>
                <h3 className="text-base font-bold text-[var(--ps-text)]">
                  Import Listings from Excel (.xlsx) or CSV (.csv)
                </h3>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Validates required columns, detects duplicates, and saves imported real-estate rows without a 360° panorama as incomplete Drafts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="rounded p-1 text-[var(--ps-text-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
                <div className="text-xs text-[var(--ps-text-muted)]">
                  Download a sample template pre-populated with valid columns (`Title`, `Category`, `Locality`, `Latitude`, `Longitude`, `PropertyType`, `PlotAreaSqm`).
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => downloadListingImportTemplate('xlsx')}
                    className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)]"
                  >
                    Template (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadListingImportTemplate('csv')}
                    className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)]"
                  >
                    Template (.csv)
                  </button>
                </div>
              </div>

              <div className="rounded-xl border-2 border-dashed border-[var(--ps-border)] p-6 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Upload className="h-4 w-4" />
                  Select .xlsx or .csv File
                </button>
              </div>

              {importResult && (
                <div className="space-y-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-xs">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
                      <div className="font-mono text-base font-bold">
                        {importResult.validListings.length}
                      </div>
                      <div className="text-[10px]">Valid Rows</div>
                    </div>
                    <div className="rounded bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                      <div className="font-mono text-base font-bold">
                        {importResult.duplicateRows.length}
                      </div>
                      <div className="text-[10px]">Duplicates</div>
                    </div>
                    <div className="rounded bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300">
                      <div className="font-mono text-base font-bold">
                        {importResult.invalidRows.length}
                      </div>
                      <div className="text-[10px]">Invalid Rows</div>
                    </div>
                  </div>

                  {importResult.draftPanoramaWarnings > 0 && (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-800 dark:text-amber-200">
                      ⚠ {importResult.draftPanoramaWarnings} imported real-estate row(s) will be saved as <strong>Draft</strong> until a compulsory 360° equirectangular panorama is uploaded.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="rounded-lg border border-[var(--ps-border)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !importResult || importResult.validListings.length === 0
                }
                onClick={handleConfirmImport}
                className="rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:opacity-40"
              >
                Confirm Import ({importResult?.validListings.length || 0} Rows)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PUBLIC PAGE PREVIEW MODAL */}
      {previewListing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl">
            <CategoryDetailView
              listing={previewListing}
              mode="modal"
              onClose={() => setPreviewListing(null)}
              onLocateOnMap={(l) => {
                setPreviewListing(null);
                onOpenListingOnMap(l.id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
