'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  Archive,
  ArrowUp,
  BarChart3,
  Building2,
  Calendar,
  Car,
  Compass,
  Copy,
  Crown,
  Edit3,
  Eye,
  History,
  Home,
  Inbox,
  Layers,
  MapPin,
  Megaphone,
  MessageSquare,
  Package,
  Plus,
  Printer,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useAppStore, useAuth } from '@/lib/store';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { isUuid } from '@/lib/payments/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  createListing,
  deleteListing,
  fetchListings,
  mapRowToListing,
  updateListing,
  type SupabaseListingRow,
} from '@/lib/supabase/listings';
import {
  CatalogueProduct,
  EnquiryRecord,
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
  shouldShowPlotAndBoundary,
  validatePanoramaScene,
} from '@/lib/rules';
import {
  generateCoverImageDataUri,
  generateEquirectangularPanoramaDataUri,
  generateProductImageDataUri,
} from '@/lib/media-generator';
import { DataTable, DataColumn } from '@/components/shared/DataTable';
import { AnalyticsWidget } from '@/components/shared/AnalyticsWidget';
import { CompletenessIndicator } from '@/components/shared/CompletenessIndicator';
import { ActivityFeed } from '@/components/shared/ActivityFeed';
import { MediatorDeskRedirectCard } from '@/components/workspaces/shared/MediatorDeskRedirectCard';
import { FormModal } from '@/components/ui/FormModal';
import { OwnerCapabilityLockCard } from '@/components/workspaces/shared/OwnerCapabilityLockCard';
import { OwnerEnquiriesAndReviewsPanel } from '@/components/workspaces/shared/OwnerEnquiriesAndReviewsPanel';
import { OwnerListingsPortfolioPanel } from '@/components/workspaces/shared/OwnerListingsPortfolioPanel';
import { OwnerOverviewAndPlanPanel } from '@/components/workspaces/shared/OwnerOverviewAndPlanPanel';
import {
  WorkspaceNavShell,
  type WorkspaceNavGroup,
} from '@/components/workspaces/shared/WorkspaceNavShell';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { normalizePermissionsJson } from '@/lib/supabase/delegations';
import { useLiveNavBadges } from '@/lib/hooks/useLiveNavBadges';
import { emitBadgesRefresh } from '@/lib/badges/badge-bus';

const OwnerSubTabSkeleton = () => (
  <div className="space-y-3 py-2">
    <div className="dd-shimmer h-24 w-full rounded-2xl border border-[var(--ps-border)]" />
    <div className="dd-shimmer h-64 w-full rounded-2xl border border-[var(--ps-border)]" />
  </div>
);

const StaffDelegationManager = dynamic(
  () =>
    import('./StaffDelegationManager').then((m) => m.StaffDelegationManager),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const ListingEditorModal = dynamic(
  () =>
    import('@/components/workspaces/shared/ListingEditorModal').then(
      (m) => m.ListingEditorModal
    ),
  { ssr: false }
);
const CategoryDetailView = dynamic(
  () =>
    import('@/components/listings/CategoryDetailView').then(
      (m) => m.CategoryDetailView
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const MarketplaceCatalogueManager = dynamic(
  () =>
    import('@/components/workspaces/MarketplaceCatalogueManager').then(
      (m) => m.MarketplaceCatalogueManager
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const OwnerBulletinsPanel = dynamic(
  () =>
    import('@/components/workspaces/OwnerBulletinsPanel').then(
      (m) => m.OwnerBulletinsPanel
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const VehicleFleetCalendarManager = dynamic(
  () =>
    import('@/components/workspaces/VehicleFleetCalendarManager').then(
      (m) => m.VehicleFleetCalendarManager
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const OwnerBookingManager = dynamic(
  () =>
    import('@/components/workspaces/bookings/OwnerBookingManager').then(
      (m) => m.OwnerBookingManager
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const OwnerCommerceManager = dynamic(
  () =>
    import('@/components/workspaces/commerce/OwnerCommerceManager').then(
      (m) => m.OwnerCommerceManager
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const OwnerPrintManager = dynamic(
  () =>
    import('@/components/workspaces/print/OwnerPrintManager').then(
      (m) => m.OwnerPrintManager
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);
const OwnerRealEstateManager = dynamic(
  () =>
    import('@/components/workspaces/real-estate/OwnerRealEstateManager').then(
      (m) => m.OwnerRealEstateManager
    ),
  { ssr: false, loading: OwnerSubTabSkeleton }
);

function canUserPerformDestructiveListingAction(
  listing: Pick<Listing, 'ownerId'> | null | undefined,
  authenticatedUserId?: string | null,
  role?: string | null
): boolean {
  if (!listing) return false;
  const normalizedRole = String(role || '')
    .trim()
    .toLowerCase();
  if (normalizedRole === 'staff') return false;
  if (normalizedRole === 'super_admin') return true;
  const cleanUserId = String(authenticatedUserId || '').trim();
  const cleanOwnerId = String(listing.ownerId || '').trim();
  if (!cleanUserId || !cleanOwnerId) return false;
  return cleanUserId === cleanOwnerId;
}

interface OwnerStaffWorkspaceProps {
  onOpenListingOnMap: (listingId: string) => void;
  initialDraftListing?: Listing | null;
  onClearInitialDraftListing?: () => void;
  initialTab?: OwnerTab;
  forcedRole?: 'owner' | 'staff';
  initialListingId?: string | null;
}

interface StaffAssignmentEntry {
  id: string;
  listingId: string;
  parentOwnerId: string | null;
  listingTitle: string;
  listingVertical: string;
  parentLifecycleStatus: string;
  status: string;
  verticalScopes: string[];
  /** v21a (P0-18): live `staff_delegations.permissions` (normalized can_* keys) */
  permissions: Record<string, boolean>;
}

type OwnerTab =
  | 'overview'
  | 'listings'
  | 'shop_kitchen'
  | 'real_estate'
  | 'bookings_stays'
  | 'print_digital'
  | 'marketplace'
  | 'bulletins'
  | 'plans_trials'
  | 'vehicles'
  | 'catalogues'
  | 'enquiries'
  | 'reviews'
  | 'analytics'
  | 'staff'
  | 'pick_n_drop';

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
  initialTab,
  forcedRole,
  initialListingId,
}: OwnerStaffWorkspaceProps) {
  const { confirm: confirmDialogAction, dialog: confirmDialogNode } =
    useConfirmDialog();
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
    saveCatalogueProduct,
    deleteCatalogueProduct,
    replyToEnquiry,
    replyToReview,
    reportReview,
    staffDelegations,
    saveStaffDelegation,
    revokeStaffDelegation,
    dynamicFields,
  } = useAppStore();
  const {
    user: authUser,
    role: syncedAuthRole,
    fullName: syncedFullName,
  } = useAuth();
  const [supabaseOwnerListings, setSupabaseOwnerListings] = useState<Listing[]>(
    []
  );
  const [isCreatingSupabaseListing, setIsCreatingSupabaseListing] =
    useState(false);

  const effectiveRole =
    forcedRole ||
    (authUser
      ? syncedAuthRole
      : currentUser.adminRole || currentUser.roleType || 'owner');
  const isStaffMode =
    forcedRole === 'staff' ||
    String(effectiveRole).toLowerCase() === 'staff' ||
    (!forcedRole && currentUser.roleType === 'staff');

  const [staffAssignments, setStaffAssignments] = useState<
    StaffAssignmentEntry[]
  >([]);
  const [selectedStaffListingId, setSelectedStaffListingId] = useState<string>(
    initialListingId || ''
  );

  // v21a (P0-18): delegated staff permissions come from the live, active
  // `staff_delegations.permissions` row for that listing (the same JSON the DB RLS helper
  // `staff_has_listing_grant` enforces) — never from the prototype Zustand store.
  const hasStaffPermission = useCallback(
    (listingId: string, permission: string): boolean => {
      const assignment = staffAssignments.find(
        (a) => a.listingId === listingId && a.status === 'active'
      );
      if (!assignment) return false;
      if (
        assignment.parentLifecycleStatus !== 'active' &&
        assignment.parentLifecycleStatus !== 'draining'
      ) {
        return false;
      }
      const key = permission.startsWith('can_') ? permission : `can_${permission}`;
      return Boolean(assignment.permissions[key]);
    },
    [staffAssignments]
  );
  const greetingName =
    syncedFullName ||
    (authUser?.user_metadata?.full_name as string | undefined) ||
    currentUser.name ||
    'Listing Operator';
  const effectiveOwnerId =
    authUser?.id ||
    (currentUser.roleType === 'owner' ? currentUser.id : 'owner-1');

  const [isLoadingRemoteListings, setIsLoadingRemoteListings] = useState(true);
  const currentAuthUserId = authUser?.id || null;

  const loadRemoteListingsNow = useCallback(async () => {
    setIsLoadingRemoteListings(true);
    if (isStaffMode && isSupabaseConfigured() && currentAuthUserId) {
      try {
        const { data: delRows } = await supabase
          .from('staff_delegations')
          .select('listing_id, assigned_listing_ids, status')
          .eq('staff_id', currentAuthUserId);

        const delegatedIds = new Set<string>();
        for (const row of (delRows || []) as Array<{
          listing_id?: string | null;
          assigned_listing_ids?: unknown;
          status?: string | null;
        }>) {
          if (row.status && row.status !== 'active') continue;
          if (row.listing_id) delegatedIds.add(String(row.listing_id));
          if (Array.isArray(row.assigned_listing_ids)) {
            row.assigned_listing_ids.forEach((id) => {
              if (typeof id === 'string' && id) delegatedIds.add(id);
            });
          }
        }

        if (delegatedIds.size > 0) {
          const { data: lRows } = await supabase
            .from('listings')
            .select('*')
            .in('id', Array.from(delegatedIds));

          if (Array.isArray(lRows)) {
            const mapped = (lRows as SupabaseListingRow[]).map((r) =>
              mapRowToListing(r)
            );
            setSupabaseOwnerListings(mapped);
            setIsLoadingRemoteListings(false);
            return;
          }
        }
      } catch {
        // Fall through to local store delegations
      }
    }

    try {
      const remoteListings = await fetchListings(effectiveOwnerId);
      setSupabaseOwnerListings(remoteListings);
    } catch {
      // Fallback to local state when Supabase table or network is unavailable
    } finally {
      setIsLoadingRemoteListings(false);
    }
  }, [effectiveOwnerId, isStaffMode, currentAuthUserId]);

  // Phase 3-C & 71-E1: Fetch authenticated owner listings or delegated staff listings from Supabase
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRemoteListingsNow();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadRemoteListingsNow]);

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

  const [activeTab, setActiveTab] = useState<OwnerTab>(initialTab || 'overview');
  useEffect(() => {
    if (!initialTab) return;
    queueMicrotask(() => {
      setActiveTab(initialTab);
    });
  }, [initialTab]);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Listing Editor Drawer / Modal State
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [isCreatingModalOpen, setIsCreatingModalOpen] = useState(false);
  const [createModalDefaultVertical, setCreateModalDefaultVertical] = useState<'general' | 'real_estate'>('general');
  const [staffTabListingId, setStaffTabListingId] = useState<string>('');
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
  const [editingProductDirty, setEditingProductDirty] = useState(false);
  const [editingProductSubmitted, setEditingProductSubmitted] = useState(false);
  const [editingProductTouched, setEditingProductTouched] = useState<
    Record<string, boolean>
  >({});

  // Enquiries Tab State & Phase 35 Real-Time Enquiries WebSocket Subscription
  const [supabaseOwnerEnquiries, setSupabaseOwnerEnquiries] = useState<
    EnquiryRecord[]
  >([]);

  const accessibleListingIds = useMemo(
    () => new Set(accessibleListings.map((l) => l.id)),
    [accessibleListings]
  );

  const accessibleListingMap = useMemo(() => {
    const map = new Map<string, Listing>();
    for (const item of accessibleListings) {
      map.set(item.id, item);
    }
    return map;
  }, [accessibleListings]);

  const mapDatabaseEnquiryRow = useCallback(
    (row: Record<string, unknown>): EnquiryRecord => {
      const listingId = String(row.listing_id || '');
      const matchedListing = accessibleListingMap.get(listingId);
      const createdAt =
        typeof row.created_at === 'string' && row.created_at
          ? row.created_at
          : new Date().toISOString();
      const rawStatus = String(row.status || 'open').toLowerCase();
      const normalizedStatus: EnquiryRecord['status'] =
        rawStatus === 'resolved'
          ? 'resolved'
          : rawStatus === 'in_progress'
            ? 'in_progress'
            : 'open';
      const senderName = String(row.sender_name || 'Visitor');
      const senderContact = String(row.sender_contact || '');

      return {
        id: String(row.id || `enq-${Date.now()}`),
        listingId,
        listingTitle: matchedListing?.title || 'Owned Listing',
        ownerId: matchedListing?.ownerId || effectiveOwnerId,
        senderName,
        senderPhone: senderContact,
        senderEmail: senderContact.includes('@') ? senderContact : '',
        message: String(row.message || ''),
        source: 'Detail Page',
        createdAt,
        status: normalizedStatus,
        activityLog: [
          {
            id: `act-${String(row.id || Date.now())}`,
            timestamp: createdAt,
            actor: senderName,
            action: 'Submitted live enquiry via Supabase.',
          },
        ],
      };
    },
    [accessibleListingMap, effectiveOwnerId]
  );

  // Fetch initial live enquiries & subscribe to real-time INSERT events on `public.enquiries`
  useEffect(() => {
    if (!isSupabaseConfigured() || accessibleListingIds.size === 0) return;

    let active = true;
    const ownedIds = Array.from(accessibleListingIds);

    supabase
      .from('enquiries')
      .select('id, listing_id, sender_name, sender_contact, message, status, created_at')
      .in('listing_id', ownedIds)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active || error || !Array.isArray(data)) return;
        const mapped = data.map((row) =>
          mapDatabaseEnquiryRow(row as Record<string, unknown>)
        );
        setSupabaseOwnerEnquiries(mapped);
      });

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      const channelName = `owner-enquiries-realtime-${effectiveOwnerId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

      if (typeof supabase.getChannels === 'function') {
        supabase.getChannels().forEach((ch) => {
          if (ch.topic.includes(channelName)) {
            void supabase.removeChannel(ch);
          }
        });
      }

      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'enquiries',
          },
          (payload) => {
            const newRow = payload.new as Record<string, unknown> | undefined;
            if (!newRow || !newRow.id) return;
            const incomingListingId = String(newRow.listing_id || '');
            if (!accessibleListingIds.has(incomingListingId)) return;

            const mappedEnquiry = mapDatabaseEnquiryRow(newRow);
            setSupabaseOwnerEnquiries((prev) =>
              prev.some((item) => item.id === mappedEnquiry.id)
                ? prev
                : [mappedEnquiry, ...prev]
            );
            setStatusBanner({
              type: 'info',
              text: `New live enquiry received from ${mappedEnquiry.senderName} on "${mappedEnquiry.listingTitle}".`,
            });
          }
        )
        .subscribe();
    } catch {
      channel = null;
    }

    return () => {
      active = false;
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [accessibleListingIds, effectiveOwnerId, mapDatabaseEnquiryRow]);

  const ownerEnquiries = useMemo(() => {
    const localFiltered = enquiries.filter((e) =>
      accessibleListingIds.has(e.listingId)
    );
    if (supabaseOwnerEnquiries.length === 0) return localFiltered;
    const seen = new Set<string>();
    const combined: EnquiryRecord[] = [];
    for (const item of [...supabaseOwnerEnquiries, ...localFiltered]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        combined.push(item);
      }
    }
    return combined;
  }, [enquiries, accessibleListingIds, supabaseOwnerEnquiries]);

  const handleReplyAndUpdateEnquiry = useCallback(
    (
      enquiryId: string,
      replyText: string,
      nextStatus: EnquiryRecord['status']
    ) => {
      replyToEnquiry(enquiryId, replyText, nextStatus);
      const now = new Date().toISOString();
      setSupabaseOwnerEnquiries((prev) =>
        prev.map((item) =>
          item.id === enquiryId
            ? {
                ...item,
                ownerReply: replyText,
                repliedAt: now,
                status: nextStatus,
                activityLog: [
                  ...item.activityLog,
                  {
                    id: `act-${Date.now()}`,
                    timestamp: now,
                    actor: greetingName,
                    action: `Updated reply and marked status as ${nextStatus}.`,
                  },
                ],
              }
            : item
        )
      );
      if (isSupabaseConfigured() && isUuid(enquiryId)) {
        void supabase
          .rpc('reply_to_enquiry', {
            p_enquiry_id: enquiryId,
            p_reply_text: replyText,
            p_next_status: nextStatus,
          })
          .then(() => {
            emitBadgesRefresh('owner_enquiry_reply');
          });
      } else {
        emitBadgesRefresh('owner_enquiry_reply');
      }
    },
    [replyToEnquiry, greetingName]
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

  // Create New Listing Template (id remains empty until first Supabase insert)
  const handleStartNewListing = (category: ListingCategory = 'business') => { setEditorError(null); setEditingListing(null); setCreateModalDefaultVertical(category === 'real_estate' ? 'real_estate' : 'general'); setIsCreatingModalOpen(true); if (Boolean(true)) return;
    const id = '';
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
  const handleSaveEditorListing = async (targetStatus: ListingStatus) => {
    if (!editingListing) return;
    if (!editingListing.title.trim()) {
      setEditorError('Listing title is required.');
      setEditorSection('basics');
      return;
    }

    const hasValidUuid = isUuid(editingListing.id);
    const existsInDb =
      hasValidUuid &&
      (listings.some((l) => l.id === editingListing.id) ||
        supabaseOwnerListings.some((l) => l.id === editingListing.id));

    try {
      const persisted = existsInDb
        ? await updateListing(
            editingListing.id,
            { ...editingListing, status: targetStatus },
            effectiveOwnerId
          )
        : await createListing(
            { ...editingListing, status: targetStatus },
            effectiveOwnerId
          );

      const res = saveListing(persisted, targetStatus);
      if (!res.ok) {
        setEditorError(res.message);
        setEditorSection('media');
        return;
      }

      setSupabaseOwnerListings((prev) => [
        persisted,
        ...prev.filter((item) => item.id !== persisted.id),
      ]);
      setStatusBanner({ type: 'success', text: res.message });
      setEditingListing(null);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to save listing changes to Supabase.';
      setEditorError(msg);
      setStatusBanner({ type: 'error', text: msg });
    }
  };

  // Create New Listing draft in Supabase (PostgreSQL assigns authoritative UUID)
  const handleCreateNewListingViaSupabase = async () => { setEditorError(null); setEditingListing(null); setCreateModalDefaultVertical('general'); setIsCreatingModalOpen(true); if (Boolean(true)) return;
    setIsCreatingSupabaseListing(true);
    const draftId = '';
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
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to create new draft listing in Supabase.',
      });
    } finally {
      setIsCreatingSupabaseListing(false);
    }
  };

  const handleDeleteListingViaSupabase = useCallback(
    async (targetListing: Listing) => {
      if (
        !canUserPerformDestructiveListingAction(
          targetListing,
          effectiveOwnerId,
          effectiveRole
        )
      ) {
        const msg =
          'Permission denied by Row-Level Security (RLS): Only the listing Owner (or a Super Admin) can delete this listing. Delegated Staff have update-only access.';
        setEditorError(msg);
        setStatusBanner({ type: 'error', text: msg });
        return;
      }

      try {
        await deleteListing(targetListing.id, effectiveOwnerId);
        setSupabaseOwnerListings((prev) =>
          prev.filter((item) => item.id !== targetListing.id)
        );
        changeListingStatus(targetListing.id, 'archived');
        setEditingListing(null);
        setStatusBanner({
          type: 'success',
          text: `Deleted listing "${targetListing.title}" (Owner ID ${targetListing.ownerId} verified).`,
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Permission denied by Row-Level Security (RLS): Unable to delete listing.';
        setEditorError(msg);
        setStatusBanner({ type: 'error', text: msg });
      }
    },
    [effectiveOwnerId, effectiveRole, changeListingStatus]
  );

  const handleArchiveListingViaSupabase = useCallback(
    async (targetListing: Listing) => {
      if (isStaffMode) {
        setStatusBanner({
          type: 'error',
          text: 'Only the Business Owner can archive or unpublish a listing.',
        });
        return;
      }
      const nextStatus: ListingStatus =
        targetListing.status === 'archived' ? 'draft' : 'archived';
      try {
        if (isUuid(targetListing.id) && isSupabaseConfigured()) {
          const updated = await updateListing(
            targetListing.id,
            { status: nextStatus },
            effectiveOwnerId
          );
          setSupabaseOwnerListings((prev) =>
            prev.map((item) => (item.id === targetListing.id ? updated : item))
          );
        }
        changeListingStatus(targetListing.id, nextStatus);
        setStatusBanner({
          type: 'success',
          text:
            nextStatus === 'archived'
              ? `"${targetListing.title}" archived and hidden from public discovery.`
              : `"${targetListing.title}" restored to Drafts.`,
        });
      } catch (err) {
        setStatusBanner({
          type: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Unable to update listing archive status.',
        });
      }
    },
    [isStaffMode, effectiveOwnerId, changeListingStatus]
  );

  const handleResubmitListingViaSupabase = useCallback(
    async (targetListing: Listing) => {
      if (isStaffMode && !hasStaffPermission(targetListing.id, 'edit_details')) {
        setStatusBanner({
          type: 'error',
          text: 'Delegated Staff Restriction: Missing "Edit Listing Details" permission to resubmit.',
        });
        return;
      }
      try {
        if (isUuid(targetListing.id) && isSupabaseConfigured()) {
          const updated = await updateListing(
            targetListing.id,
            { status: 'pending_verification' },
            effectiveOwnerId
          );
          setSupabaseOwnerListings((prev) =>
            prev.map((item) => (item.id === targetListing.id ? updated : item))
          );
        }
        changeListingStatus(targetListing.id, 'pending_verification');
        setStatusBanner({
          type: 'success',
          text: `Resubmitted "${targetListing.title}" for moderation review.`,
        });
      } catch (err) {
        setStatusBanner({
          type: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Unable to resubmit listing for review.',
        });
      }
    },
    [isStaffMode, hasStaffPermission, effectiveOwnerId, changeListingStatus]
  );

  const handleTransferListingOwnership = async (
    targetListing: Listing,
    newOwnerId: string,
    newOwnerName?: string
  ) => {
    if (
      !canUserPerformDestructiveListingAction(
        targetListing,
        effectiveOwnerId,
        effectiveRole
      )
    ) {
      const msg =
        'Permission denied by Row-Level Security (RLS): Only the listing Owner (or a Super Admin) can transfer listing ownership.';
      setEditorError(msg);
      setStatusBanner({ type: 'error', text: msg });
      return;
    }

    try {
      const updatedOwnerName = newOwnerName || targetListing.ownerName;
      await updateListing(
        targetListing.id,
        {
          ownerId: newOwnerId,
          ownerName: updatedOwnerName,
        },
        effectiveOwnerId
      );
      const nextListing: Listing = {
        ...targetListing,
        ownerId: newOwnerId,
        ownerName: updatedOwnerName,
      };
      saveListing(nextListing, nextListing.status);
      setEditingListing(nextListing);
      setStatusBanner({
        type: 'success',
        text: `Transferred ownership of "${targetListing.title}" to ${updatedOwnerName} (${newOwnerId}).`,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Permission denied by Row-Level Security (RLS): Unable to transfer listing ownership.';
      setEditorError(msg);
      setStatusBanner({ type: 'error', text: msg });
    }
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
                    void (async () => {
                      const accepted = await confirmDialogAction({
                        title: `Delete "${row.title}"?`,
                        description:
                          'This will permanently remove the listing from Supabase and cannot be undone.',
                        confirmLabel: 'Delete Permanently',
                        cancelLabel: 'Cancel',
                        variant: 'danger',
                      });
                      if (!accepted) return;
                      void handleDeleteListingViaSupabase(row);
                    })();
                  }}
                  data-testid={`owner-delete-listing-${row.id}`}
                  className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/20 cursor-pointer"
                  title="Delete Listing"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
          </div>
        ),
      },
    ],
    [
      isStaffMode,
      confirmDialogAction,
      handleOpenEditListing,
      handleDeleteListingViaSupabase,
      duplicateListing,
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



  useEffect(() => {
    if (!isStaffMode || !authUser?.id || !isSupabaseConfigured()) return;
    let active = true;
    const loadStaffAssignments = async () => {
      try {
        const { data, error } = await supabase
          .from('staff_delegations')
          .select(
            'id, listing_id, status, vertical_scopes, permissions, listings!inner(id, owner_id, title, listing_vertical, lifecycle_status)'
          )
          .eq('staff_id', authUser.id)
          .eq('status', 'active');
        if (!active || error || !Array.isArray(data)) return;
        const mapped: StaffAssignmentEntry[] = [];
        for (const row of data as Array<Record<string, unknown>>) {
          const joined = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          if (!joined) continue;

          let parsedScopes: string[] = [];
          if (Array.isArray(row.vertical_scopes)) {
            parsedScopes = row.vertical_scopes.map((s) => String(s));
          } else if (
            row.vertical_scopes &&
            typeof row.vertical_scopes === 'object'
          ) {
            const obj = row.vertical_scopes as Record<string, unknown>;
            parsedScopes = Object.entries(obj)
              .filter(([, enabled]) => Boolean(enabled))
              .map(([k]) => {
                if (k === 'print_ops') return 'print_queue';
                if (k === 'booking_desk') return 'booking_checkin';
                if (k === 'kitchen_shop') return 'kitchen_shop_stock';
                if (k === 'visit_desk') return 'property_visits';
                return k;
              });
          }
          if (parsedScopes.length === 0) {
            parsedScopes = ['enquiries'];
          }

          mapped.push({
            id: String(row.id || ''),
            listingId: String(row.listing_id || joined.id || ''),
            parentOwnerId: joined.owner_id ? String(joined.owner_id) : null,
            listingTitle: String(joined.title || 'Assigned Business'),
            listingVertical: String(joined.listing_vertical || 'general'),
            parentLifecycleStatus: String(
              joined.lifecycle_status || 'active'
            ),
            status: String(row.status || 'active'),
            verticalScopes: parsedScopes,
            permissions: normalizePermissionsJson(row.permissions) as Record<
              string,
              boolean
            >,
          });
        }
        setStaffAssignments(mapped);
        if (mapped.length > 0 && !selectedStaffListingId) {
          setSelectedStaffListingId(mapped[0].listingId);
        }
      } catch {
        // Non-blocking
      }
    };
    void loadStaffAssignments();
    return () => {
      active = false;
    };
  }, [isStaffMode, authUser?.id, selectedStaffListingId]);

  const activeStaffAssignment =
    staffAssignments.find((a) => a.listingId === selectedStaffListingId) ||
    staffAssignments[0] ||
    null;
  const isStaffParentArchived = Boolean(
    isStaffMode &&
      activeStaffAssignment &&
      activeStaffAssignment.parentLifecycleStatus !== 'active' &&
      activeStaffAssignment.parentLifecycleStatus !== 'draining'
  );

  // Pass v18a: Strict Owner-inherited entitlement check
  // In Staff mode, ALWAYS evaluate against the parent business's owner_id + listing_id (never the staff member's personal Free tier)
  const entitlementOwnerId = isStaffMode
    ? activeStaffAssignment?.parentOwnerId ||
      accessibleListings[0]?.ownerId ||
      null
    : authUser?.id || effectiveOwnerId || null;
  const entitlementListingId = isStaffMode
    ? activeStaffAssignment?.listingId || accessibleListings[0]?.id || null
    : initialListingId || accessibleListings[0]?.id || null;

  const { entitlements, can: canUseFeature } = useEffectiveEntitlements(
    entitlementOwnerId,
    entitlementListingId
  );

  const [planAutoVerifyEnabled, setPlanAutoVerifyEnabled] = useState(false);
  const activePlanIdsKey = (entitlements?.active_plan_ids || []).join(',');

  useEffect(() => {
    let active = true;
    const planIds = activePlanIdsKey ? activePlanIdsKey.split(',').filter(Boolean) : [];
    const timer = window.setTimeout(() => {
      if (!isSupabaseConfigured() || planIds.length === 0) {
        if (active) setPlanAutoVerifyEnabled(false);
        return;
      }
      void supabase
        .from('subscription_plans')
        // v21a (P0-20): `auto_verify_listings` lives in the `entitlements` JSONB (no table column)
        .select('id, entitlements')
        .in('id', planIds)
        .then(({ data }) => {
          if (!active || !Array.isArray(data)) return;
          setPlanAutoVerifyEnabled(
            data.some((row) => {
              const planRow = row as {
                entitlements?: Record<string, unknown> | null;
              };
              return Boolean(planRow.entitlements?.auto_verify_listings);
            })
          );
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activePlanIdsKey]);

  const hasAutoVerifyPlan =
    planAutoVerifyEnabled || canUseFeature('verified_badge');

  const canShopKitchen =
    canUseFeature('shop_basket_checkout') ||
    canUseFeature('restaurant_menu_ordering') ||
    canUseFeature('restaurant_table_booking');
  const canRealEstate =
    canUseFeature('real_estate_verified_boost') ||
    canUseFeature('real_estate_site_visit_queue') ||
    canUseFeature('real_estate_polygon_overlay');
  const canBookingsStays =
    canUseFeature('booking_slots') || canUseFeature('hotel_multi_room');
  const canPrintDigital =
    canUseFeature('print_online_orders') ||
    canUseFeature('print_custom_digital');
  const canPndDispatch =
    canUseFeature('pick_n_drop_merchant_dispatch') ||
    canUseFeature('pick_n_drop_dispatch');
  const canBulletins = canUseFeature('bulletin_posting');

  // Strict scope check for Delegated Staff:
  // Owners always see their operational tabs (locked capabilities render <OwnerCapabilityLockCard />).
  // Staff see only tabs permitted by their active delegation's `vertical_scopes` and parent lifecycle.
  const staffAllowsScope = useCallback(
    (scopeKey: string): boolean => {
      if (!isStaffMode) return true;
      if (isStaffParentArchived) return false;
      // v21a (P0-18): no (or still-loading) assignment → show nothing instead of empty,
      // RLS-blocked desks
      if (!activeStaffAssignment) {
        return false;
      }
      if (activeStaffAssignment.status !== 'active') {
        return false;
      }
      if (activeStaffAssignment.verticalScopes.length === 0) {
        return true;
      }
      return activeStaffAssignment.verticalScopes.includes(scopeKey);
    },
    [isStaffMode, isStaffParentArchived, activeStaffAssignment]
  );

  const handleNavigateFromOverview = useCallback((sectionKey: string) => {
    if (sectionKey === 'listings_portfolio') setActiveTab('listings');
    else if (sectionKey === 'marketplace_catalogue') setActiveTab('marketplace');
    else if (sectionKey === 'team_staff') setActiveTab('staff');
    else if (sectionKey === 'plans_bulletins') setActiveTab('bulletins');
    else if (sectionKey === 'plans_subscription') setActiveTab('plans_trials');
  }, []);

  const liveOwnerBadges = useLiveNavBadges({
    userId: authUser?.id || currentUser?.id,
    hasOwnerHat: !isStaffMode,
    hasStaffHat: isStaffMode,
  });

  const actionRequiredListingsCount = useMemo(
    () =>
      accessibleListings.filter((l) => {
        const s = String(l.status || '');
        return (
          s === 'changes_requested' ||
          s === 'pending' ||
          s === 'pending_verification' ||
          s === 'rejected'
        );
      }).length,
    [accessibleListings]
  );

  const unrepliedReviewsCount = useMemo(
    () => ownerReviews.filter((r) => !r.ownerReply).length,
    [ownerReviews]
  );

  // 7 Canonical Nested Groups for WorkspaceNavShell
  const navGroups = useMemo<WorkspaceNavGroup[]>(
    () => [
      {
        id: 'group_overview',
        label: isStaffMode ? 'Overview & Scope' : 'Overview & Plan',
        shortLabel: 'Overview',
        icon: Layers,
        items: [
          {
            id: 'overview',
            label: isStaffMode ? 'Staff Overview' : 'Overview & Quotas',
            shortLabel: 'Overview',
            icon: Layers,
            badge:
              kpis.needsAttention.length > 0
                ? kpis.needsAttention.length
                : undefined,
          },
          {
            id: 'analytics',
            label: 'Performance Analytics',
            shortLabel: 'Analytics',
            icon: BarChart3,
          },
        ],
      },
      {
        id: 'group_listings',
        label: 'My Listings & Real Estate',
        shortLabel: 'Listings',
        icon: Building2,
        items: [
          {
            id: 'listings',
            label: isStaffMode ? 'Assigned Listings' : 'All Listings',
            shortLabel: 'Listings',
            icon: Building2,
            badge:
              actionRequiredListingsCount > 0
                ? actionRequiredListingsCount
                : undefined,
          },
          {
            id: 'real_estate',
            label: isStaffMode ? 'Site Visits Desk' : 'Real Estate & Visits',
            shortLabel: 'Real Estate',
            icon: Home,
            hidden: !staffAllowsScope('property_visits'),
          },
          {
            id: 'vehicles',
            label: 'Vehicles & Schedule',
            shortLabel: 'Vehicles',
            icon: Car,
            hidden: isStaffMode,
          },
        ],
      },
      {
        id: 'group_marketplace',
        label: 'Marketplace Catalogue',
        shortLabel: 'Marketplace',
        icon: ShoppingBag,
        items: [
          {
            id: 'marketplace',
            label: isStaffMode
              ? 'Marketplace Stock'
              : 'Live Shop Marketplace',
            shortLabel: 'Marketplace',
            icon: ShoppingBag,
          },
          {
            id: 'catalogues',
            label: 'Product Catalogues',
            shortLabel: 'Catalogues',
            icon: Package,
          },
        ],
      },
      {
        id: 'group_orders',
        label: 'Orders & Bookings',
        shortLabel: 'Orders',
        icon: Calendar,
        items: [
          {
            id: 'shop_kitchen',
            label: isStaffMode ? 'Shop & Kitchen Queue' : 'Shop & Kitchen Desk',
            shortLabel: 'Shop & Kitchen',
            icon: ShoppingBag,
            hidden: !staffAllowsScope('kitchen_shop_stock'),
            badge:
              liveOwnerBadges.ownerOrders > 0
                ? liveOwnerBadges.ownerOrders
                : undefined,
          },
          {
            id: 'bookings_stays',
            label: isStaffMode
              ? 'Bookings & Walk-Ins'
              : 'Bookings & Stays Desk',
            shortLabel: 'Bookings',
            icon: Calendar,
            hidden: !staffAllowsScope('booking_checkin'),
            badge:
              liveOwnerBadges.ownerBookings > 0
                ? liveOwnerBadges.ownerBookings
                : undefined,
          },
          {
            id: 'print_digital',
            label: isStaffMode ? 'Print Queue' : 'Print & Digital Suite',
            shortLabel: 'Print Suite',
            icon: Printer,
            hidden: !staffAllowsScope('print_queue'),
            badge:
              liveOwnerBadges.ownerPrint > 0
                ? liveOwnerBadges.ownerPrint
                : undefined,
          },
          {
            id: 'pick_n_drop',
            label: 'Pick N Drop Dispatch',
            shortLabel: 'Pick N Drop',
            icon: Truck,
            hidden: isStaffMode,
          },
        ],
      },
      {
        id: 'group_enquiries',
        label: 'Enquiries & Reviews',
        shortLabel: 'Enquiries',
        icon: Inbox,
        items: [
          {
            id: 'enquiries',
            label: 'Enquiry Inbox',
            shortLabel: 'Enquiries',
            icon: Inbox,
            badge: kpis.openEnquiries > 0 ? kpis.openEnquiries : undefined,
          },
          {
            id: 'reviews',
            label: 'Customer Reviews',
            shortLabel: 'Reviews',
            icon: MessageSquare,
            badge:
              unrepliedReviewsCount > 0 ? unrepliedReviewsCount : undefined,
          },
        ],
      },
      {
        id: 'group_team',
        label: 'Team & Staff',
        shortLabel: 'Team & Staff',
        icon: Users,
        hidden: isStaffMode,
        items: [
          {
            id: 'staff',
            label: 'Staff & Delegation',
            shortLabel: 'Staff Team',
            icon: Users,
            hidden: isStaffMode,
          },
        ],
      },
      {
        id: 'group_plans',
        label: 'Plans, Trials & Pay-Per',
        shortLabel: 'Plans & Pay-Per',
        icon: Crown,
        hidden: isStaffMode,
        items: [
          {
            id: 'plans_trials',
            label: 'Plans, Trials & Renewals',
            shortLabel: 'Plans & Trials',
            icon: Crown,
            hidden: isStaffMode,
          },
          {
            id: 'bulletins',
            label: 'Bulletins & Pass Quota',
            shortLabel: 'Bulletins',
            icon: Megaphone,
            hidden: isStaffMode || !canBulletins,
          },
        ],
      },
    ],
    [
      isStaffMode,
      kpis.needsAttention.length,
      kpis.openEnquiries,
      actionRequiredListingsCount,
      liveOwnerBadges.ownerOrders,
      liveOwnerBadges.ownerBookings,
      liveOwnerBadges.ownerPrint,
      unrepliedReviewsCount,
      staffAllowsScope,
      canBulletins,
    ]
  );

  const sidebarContextSlot = isStaffMode ? (
    <div
      data-testid="staff-acting-for-context-pill"
      className="rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 p-2.5 space-y-2 text-xs"
    >
      <div className="flex items-center gap-1.5 font-extrabold text-[var(--ps-text)]">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
        <span className="truncate">
          Acting as Delegated Staff for{' '}
          {activeStaffAssignment?.listingTitle ||
            accessibleListings[0]?.title ||
            'Assigned Business'}
        </span>
      </div>
      {staffAssignments.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {staffAssignments.map((asgn) => {
            const isSelected =
              activeStaffAssignment?.listingId === asgn.listingId;
            return (
              <button
                key={asgn.id}
                type="button"
                onClick={() => setSelectedStaffListingId(asgn.listingId)}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
                }`}
              >
                {asgn.listingTitle}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <div className="w-full max-w-7xl mx-auto min-w-0 overflow-x-clip py-2">
      {/* Workspace Header */}
      <div className="mb-4 sm:mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-5 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              {isStaffMode
                ? 'Staff / Agent Delegated Workspace'
                : 'Listing Owner Workspace'}
            </span>
            <span
              data-testid="workspace-user-role-badge"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300"
            >
              Role: {effectiveRole.replace(/_/g, ' ')}
            </span>
            {isStaffMode && (
              <span
                data-testid="workspace-staff-access-badge"
                className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300"
              >
                Staff Access
              </span>
            )}
            <span
              data-testid="workspace-user-greeting"
              className="text-xs text-[var(--ps-text-muted)] truncate max-w-full"
            >
              Welcome back,{' '}
              <strong className="text-[var(--ps-text)]">{greetingName}</strong>
              {currentUser.email ? ` (${currentUser.email})` : ''}
            </span>
          </div>
          <h1 className="mt-1.5 text-base sm:text-xl font-bold leading-snug tracking-tight text-[var(--ps-text)] break-words">
            {isStaffMode
              ? `Hello ${greetingName} — Assigned Listings & Delegated Operations`
              : `Hello ${greetingName} — Portfolio, 360° Property Media & Business Catalogues`}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[var(--ps-text-muted)] line-clamp-2 sm:line-clamp-none">
            {isStaffMode
              ? 'Your workspace is strictly scoped to listings and permissions delegated by the listing owner.'
              : 'Manage multi-category listings, enforce real-estate 360° equirectangular panoramas, update product catalogues, and respond to sample enquiries.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {!isStaffMode && (
            <>
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

      {/* Status Notification Toast/Banner */}
      {statusBanner && (
        <div
          className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
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
            className="ml-4 rounded p-1 hover:bg-black/5 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Staff Parent Closed Alert */}
      {isStaffMode && isStaffParentArchived && activeStaffAssignment && (
        <div
          role="alert"
          data-testid="staff-parent-archived-notice"
          className="mb-5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200 font-medium"
        >
          <strong>Parent Business Closed:</strong> &ldquo;
          {activeStaffAssignment.listingTitle}&rdquo; has been archived by the
          owner. Operational desks are suspended for this assignment.
        </div>
      )}

      {/* RENOVATED v18a WORKSPACE NAVIGATION SHELL */}
      <WorkspaceNavShell
        groups={navGroups}
        activeId={activeTab}
        onSelect={(nextId) => setActiveTab(nextId as OwnerTab)}
        navTitle={isStaffMode ? 'Staff Desk Navigation' : 'Owner Workspace'}
        contextSwitcherSlot={sidebarContextSlot}
        testIdPrefix={isStaffMode ? 'staff-workspace-nav' : 'owner-workspace-nav'}
      >
      {/* TAB 1: OVERVIEW & PLAN */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <OwnerOverviewAndPlanPanel
            targetOwnerId={entitlementOwnerId}
            activeListingId={entitlementListingId}
            activeBusinessTitle={
              isStaffMode
                ? activeStaffAssignment?.listingTitle ||
                  accessibleListings[0]?.title ||
                  'Assigned Business'
                : accessibleListings[0]?.title || null
            }
            isStaffMode={isStaffMode}
            fallbackCounts={{
              listingsUsed: accessibleListings.length,
              staffUsed: staffDelegations.filter((d) => d.status === 'active')
                .length,
            }}
            viewMode="overview"
            onNavigateToSection={handleNavigateFromOverview}
            onNotice={setStatusBanner}
          />

          {/* Synthetic Performance Analytics Widget */}
          <AnalyticsWidget
            mapImpressions={kpis.mapImpressions}
            detailVisits={kpis.detailVisits}
            whatsappClicks={accessibleListings.reduce(
              (sum, l) =>
                sum + (l.directionClicksCount || 0) + l.enquiriesCount,
              0
            )}
          />

          {/* Primary KPI Strip */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 min-w-0">
              <div className="text-[11px] sm:text-xs font-medium text-[var(--ps-text-muted)] truncate">
                Total Listings
              </div>
              <div className="mt-1 font-mono text-lg sm:text-2xl font-bold text-[var(--ps-text)] truncate">
                {kpis.total}
              </div>
              <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 truncate">
                {kpis.published} published live
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 min-w-0">
              <div className="text-[11px] sm:text-xs font-medium text-[var(--ps-text-muted)] truncate">
                Drafts &amp; Pending
              </div>
              <div className="mt-1 font-mono text-lg sm:text-2xl font-bold text-[var(--ps-text)] truncate">
                {kpis.draft + kpis.submitted}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                {kpis.draft} draft • {kpis.submitted} submitted
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 min-w-0">
              <div className="text-[11px] sm:text-xs font-medium text-[var(--ps-text-muted)] truncate">
                Changes / Archived
              </div>
              <div className="mt-1 font-mono text-lg sm:text-2xl font-bold text-amber-600 dark:text-amber-400 truncate">
                {kpis.changesRequested}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                {kpis.archivedOrSuspended} archived/suspended
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 min-w-0">
              <div className="text-[11px] sm:text-xs font-medium text-[var(--ps-text-muted)] truncate">
                Total Views
              </div>
              <div className="mt-1 font-mono text-lg sm:text-2xl font-bold text-[var(--ps-text)] truncate">
                {kpis.views.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                {kpis.mapImpressions.toLocaleString('en-IN')} map impressions
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 min-w-0">
              <div className="text-[11px] sm:text-xs font-medium text-[var(--ps-text-muted)] truncate">
                Detail Visits &amp; Saves
              </div>
              <div className="mt-1 font-mono text-lg sm:text-2xl font-bold text-[var(--ps-text)] truncate">
                {kpis.detailVisits.toLocaleString('en-IN')}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                {kpis.follows.toLocaleString('en-IN')} visitor saves
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 min-w-0">
              <div className="text-[11px] sm:text-xs font-medium text-[var(--ps-text-muted)] truncate">
                Open Enquiries
              </div>
              <div className="mt-1 font-mono text-lg sm:text-2xl font-bold text-[var(--ps-accent)] truncate">
                {kpis.openEnquiries}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ps-text-muted)] truncate">
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

            {/* Recent Notifications & Live Activity Feed */}
            <div className="space-y-6">
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

              <ActivityFeed
                userId={effectiveOwnerId}
                title="Recent Activity Feed"
                fallbackItems={notifications.slice(0, 5).map((n) => ({
                  id: n.id,
                  label: `${n.title} — ${n.message}`,
                  timestamp: n.createdAt,
                }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LISTINGS PORTFOLIO (v18b Renovated) */}
      {activeTab === 'listings' && (
        <OwnerListingsPortfolioPanel
          listings={accessibleListings}
          isLoading={isLoadingRemoteListings && accessibleListings.length === 0}
          isStaffMode={isStaffMode}
          hasAutoVerifyPlan={hasAutoVerifyPlan}
          canEditListing={(listingId) =>
            !isStaffMode || hasStaffPermission(listingId, 'edit_details')
          }
          onCreateNew={() => handleStartNewListing('business')}
          onEditListing={handleOpenEditListing}
          onPreviewListing={(listing) => setPreviewListing(listing)}
          onLocateOnMap={onOpenListingOnMap}
          onDuplicateListing={
            !isStaffMode
              ? (listing) => {
                  const copy = duplicateListing(listing.id);
                  if (copy) {
                    setStatusBanner({
                      type: 'info',
                      text: `Created draft duplicate "${copy.title}".`,
                    });
                  }
                }
              : undefined
          }
          onArchiveListing={handleArchiveListingViaSupabase}
          onResubmitListing={handleResubmitListingViaSupabase}
          onDeleteListing={handleDeleteListingViaSupabase}
          onRefresh={loadRemoteListingsNow}
          onNotice={setStatusBanner}
        />
      )}

      {/* TAB 3: BUSINESS PRODUCT CATALOGUES */}
      {activeTab === 'catalogues' && (
        <div className="space-y-5">
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 md:flex-row md:items-center">
            <div className="flex-1 min-w-0 max-w-md">
              <CustomSelectModal
                label="Select Business Listing to Manage Catalogue"
                value={selectedCatalogueBusiness?.id || ''}
                onChange={(nextId) => setSelectedCatalogueBizId(nextId)}
                placeholder="Choose a business listing"
                options={businessListings.map((b) => ({
                  value: b.id,
                  label: `${b.title} (${b.locality})`,
                  description: `${b.businessDetails?.catalogue.length || 0} Products`,
                }))}
              />
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <input
                type="text"
                value={catalogueSearch}
                onChange={(e) => setCatalogueSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full sm:w-auto rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
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
                  setEditingProductDirty(false);
                  setEditingProductSubmitted(false);
                  setEditingProductTouched({});
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
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shrink-0 cursor-pointer"
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
                      onClick={() => {
                        setEditingProductDirty(false);
                        setEditingProductSubmitted(false);
                        setEditingProductTouched({});
                        setEditingProduct({ ...prod });
                      }}
                      className="min-h-[36px] rounded-lg border border-[var(--ps-border)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
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
                      className="min-h-[36px] rounded-lg border border-[var(--ps-border)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                    >
                      Duplicate
                    </button>
                    {!isStaffMode && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedCatalogueBusiness) return;
                          void (async () => {
                            const accepted = await confirmDialogAction({
                              title: `Delete "${prod.name}"?`,
                              description: `This removes "${prod.name}" from ${selectedCatalogueBusiness.title}'s product catalogue.`,
                              confirmLabel: 'Delete Product',
                              cancelLabel: 'Cancel',
                              variant: 'danger',
                            });
                            if (!accepted) return;
                            deleteCatalogueProduct(
                              selectedCatalogueBusiness.id,
                              prod.id
                            );
                            setStatusBanner({
                              type: 'info',
                              text: `Removed "${prod.name}" from ${selectedCatalogueBusiness.title}.`,
                            });
                          })();
                        }}
                        className="min-h-[36px] rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Product FormModal (v18b) */}
          <FormModal
            isOpen={Boolean(editingProduct && selectedCatalogueBusiness)}
            onClose={() => {
              setEditingProduct(null);
              setEditingProductDirty(false);
              setEditingProductSubmitted(false);
              setEditingProductTouched({});
            }}
            title={
              editingProduct?.name
                ? 'Edit Catalogue Product'
                : 'New Catalogue Product'
            }
            subtitle={
              selectedCatalogueBusiness
                ? `Catalogue item for ${selectedCatalogueBusiness.title}`
                : undefined
            }
            isDirty={editingProductDirty}
            isValid={Boolean(
              editingProduct &&
                editingProduct.name.trim().length > 0 &&
                Number.isFinite(editingProduct.price) &&
                editingProduct.price > 0
            )}
            validationSummary={
              editingProductSubmitted && editingProduct
                ? [
                    ...(!editingProduct.name.trim()
                      ? ['Product name is required.']
                      : []),
                    ...(!Number.isFinite(editingProduct.price) ||
                    editingProduct.price <= 0
                      ? ['Enter a valid INR price greater than ₹0.']
                      : []),
                  ]
                : undefined
            }
            onSubmitAttempt={() => setEditingProductSubmitted(true)}
            submitLabel="Save Product"
            confirmSubmitTitle="Save Catalogue Product?"
            confirmSubmitDescription="Updates this product immediately on your business listing's catalogue."
            maxWidthClassName="max-w-lg"
            hints={[
              'Include clear product names and accurate INR pricing. Changes appear immediately on your listing profile.',
            ]}
            onSubmit={() => {
              if (!editingProduct || !selectedCatalogueBusiness) return;
              if (
                !editingProduct.name.trim() ||
                !Number.isFinite(editingProduct.price) ||
                editingProduct.price <= 0
              ) {
                return;
              }
              saveCatalogueProduct(selectedCatalogueBusiness.id, {
                ...editingProduct,
                name: editingProduct.name.trim(),
                imageUrl: generateProductImageDataUri(
                  editingProduct.name.trim(),
                  editingProduct.category,
                  editingProduct.price
                ),
              });
              setEditingProduct(null);
              setEditingProductDirty(false);
              setEditingProductSubmitted(false);
              setEditingProductTouched({});
              setStatusBanner({
                type: 'success',
                text: `Saved product "${editingProduct.name.trim()}" to ${selectedCatalogueBusiness.title}.`,
              });
            }}
          >
            {editingProduct && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    value={editingProduct.name}
                    onChange={(e) => {
                      setEditingProductDirty(true);
                      setEditingProductTouched((prev) => ({
                        ...prev,
                        name: true,
                      }));
                      setEditingProduct({
                        ...editingProduct,
                        name: e.target.value,
                      });
                    }}
                    onBlur={() =>
                      setEditingProductTouched((prev) => ({
                        ...prev,
                        name: true,
                      }))
                    }
                    placeholder="e.g. Premium Glossy Business Cards (100 pcs)"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                  />
                  {(editingProductSubmitted || editingProductTouched.name) &&
                    !editingProduct.name.trim() && (
                      <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        Product name is required.
                      </p>
                    )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Category
                    </label>
                    <input
                      type="text"
                      value={editingProduct.category}
                      onChange={(e) => {
                        setEditingProductDirty(true);
                        setEditingProduct({
                          ...editingProduct,
                          category: e.target.value,
                        });
                      }}
                      className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                      Price (INR) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editingProduct.price}
                      onChange={(e) => {
                        setEditingProductDirty(true);
                        setEditingProductTouched((prev) => ({
                          ...prev,
                          price: true,
                        }));
                        setEditingProduct({
                          ...editingProduct,
                          price: parseFloat(e.target.value) || 0,
                        });
                      }}
                      onBlur={() =>
                        setEditingProductTouched((prev) => ({
                          ...prev,
                          price: true,
                        }))
                      }
                      className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                    />
                    {(editingProductSubmitted || editingProductTouched.price) &&
                      (!Number.isFinite(editingProduct.price) ||
                        editingProduct.price <= 0) && (
                        <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                          Enter a valid price greater than ₹0.
                        </p>
                      )}
                  </div>
                </div>
                <div>
                  <CustomSelectModal
                    label="Availability"
                    value={editingProduct.availability}
                    onChange={(val) => {
                      setEditingProductDirty(true);
                      setEditingProduct({
                        ...editingProduct,
                        availability:
                          val as CatalogueProduct['availability'],
                      });
                    }}
                    options={[
                      { value: 'in_stock', label: 'In Stock' },
                      { value: 'low_stock', label: 'Low Stock' },
                      { value: 'made_to_order', label: 'Made to Order' },
                      { value: 'out_of_stock', label: 'Out of Stock' },
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                    Description
                  </label>
                  <textarea
                    rows={3}
                    value={editingProduct.description}
                    onChange={(e) => {
                      setEditingProductDirty(true);
                      setEditingProduct({
                        ...editingProduct,
                        description: e.target.value,
                      });
                    }}
                    className="mt-1 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-sm text-[var(--ps-text)]"
                  />
                </div>
              </div>
            )}
          </FormModal>
        </div>
      )}

      {/* TAB 4: ENQUIRY CENTRE (v18b Renovated) */}
      {activeTab === 'enquiries' && (
        <OwnerEnquiriesAndReviewsPanel
          view="enquiries"
          listings={accessibleListings}
          fallbackEnquiries={ownerEnquiries}
          fallbackReviews={ownerReviews}
          isStaffMode={isStaffMode}
          canReplyEnquiry={(listingId) =>
            !isStaffMode || hasStaffPermission(listingId, 'reply_enquiries')
          }
          onReplyLocalEnquiry={handleReplyAndUpdateEnquiry}
          onReplyLocalReview={replyToReview}
          onReportLocalReview={reportReview}
          onNotice={setStatusBanner}
        />
      )}

      {/* TAB 5: REVIEWS & REPLIES (v18b Renovated) */}
      {activeTab === 'reviews' && (
        <OwnerEnquiriesAndReviewsPanel
          view="reviews"
          listings={accessibleListings}
          fallbackEnquiries={ownerEnquiries}
          fallbackReviews={ownerReviews}
          isStaffMode={isStaffMode}
          canReplyReview={(listingId) =>
            !isStaffMode || hasStaffPermission(listingId, 'reply_reviews')
          }
          onReplyLocalEnquiry={handleReplyAndUpdateEnquiry}
          onReplyLocalReview={replyToReview}
          onReportLocalReview={reportReview}
          onNotice={setStatusBanner}
        />
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
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--ps-text)]">Select Business to Manage Team &amp; Permissions</h2>
              <p className="text-xs text-[var(--ps-text-muted)]">Search registered members by @username and configure individual permissions per staff member.</p>
            </div>
            <div className="min-w-[240px]">
              <CustomSelectModal
                value={staffTabListingId || accessibleListings[0]?.id || ''}
                onChange={(nextId) => setStaffTabListingId(nextId)}
                options={accessibleListings.map((l) => ({
                  value: l.id,
                  label: `${l.title} (${(l.listing_vertical || 'general').replace(/_/g, ' ')})`,
                }))}
                placeholder="Select a listing"
              />
            </div>
          </div>
          {(() => {
            const targetListing =
              accessibleListings.find(
                (l) => l.id === (staffTabListingId || accessibleListings[0]?.id)
              ) || accessibleListings[0];
            return (
              <StaffDelegationManager
                listingId={targetListing?.id}
                listingTitle={targetListing?.title}
                listingVertical={targetListing?.listing_vertical || 'general'}
                availableListings={accessibleListings.map((l) => ({
                  id: l.id,
                  title: l.title,
                  vertical: l.listing_vertical || 'general',
                }))}
                onChangeTargetListingId={(nextId) => setStaffTabListingId(nextId)}
                onUpgradePlan={() => setActiveTab('plans_trials')}
              />
            );
          })()}
        </div>
      )}
      {Boolean(false) && activeTab === 'staff' && !isStaffMode && (
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
                  placeholder="staff@ddoodle.in"
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
                      newStaffEmail.trim() || 'staff@ddoodle.in',
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

      {/* TAB: REAL ESTATE DESK (OWNER FULL / STAFF SITE VISITS ONLY) */}
      {activeTab === 'real_estate' &&
        (canRealEstate ? (
          <OwnerRealEstateManager
            isStaffMode={isStaffMode}
            listings={accessibleListings.map((l) => ({
              id: l.id,
              title: l.title,
              locality: l.locality,
              hubId: (l as unknown as { hubId?: string | null }).hubId ?? null,
              listing_vertical: l.listing_vertical ?? null,
            }))}
          />
        ) : (
          <OwnerCapabilityLockCard
            title="Real Estate Site Visits & Property Desk Locked"
            entitlementLabel="Real Estate Site Visit Queue / Verified Boost"
            description="Manage scheduled property site visits, land polygon boundaries, and buyer visit calendars once enabled on the Business Owner's subscription plan."
            isStaffMode={isStaffMode}
            onUpgradePlan={() => setActiveTab('plans_trials')}
            testId="lock-card-real-estate"
          />
        ))}

      {/* TAB: SHOP & KITCHEN DESK (OWNER FULL / STAFF LIVE QUEUE & STOCK ONLY) */}
      {activeTab === 'shop_kitchen' &&
        (canShopKitchen ? (
          <OwnerCommerceManager
            isStaffMode={isStaffMode}
            listings={accessibleListings.map((l) => ({
              id: l.id,
              title: l.title,
              locality: l.locality,
              hubId: (l as unknown as { hubId?: string | null }).hubId ?? null,
              listing_vertical: l.listing_vertical ?? null,
            }))}
          />
        ) : (
          <OwnerCapabilityLockCard
            title="Shop & Kitchen Orders Desk Locked"
            entitlementLabel="Shop Basket Checkout / Restaurant Menu Ordering"
            description="Accept incoming shop baskets, kitchen KOT orders, and live stock controls once the Business Owner activates a plan with online ordering."
            isStaffMode={isStaffMode}
            onUpgradePlan={() => setActiveTab('plans_trials')}
            testId="lock-card-shop-kitchen"
          />
        ))}

      {/* TAB: BOOKINGS & STAYS DESK (OWNER FULL / STAFF LIVE DESK ONLY) */}
      {activeTab === 'bookings_stays' &&
        (canBookingsStays ? (
          <OwnerBookingManager
            isStaffMode={isStaffMode}
            listings={accessibleListings.map((l) => ({
              id: l.id,
              title: l.title,
              locality: l.locality,
              hubId: (l as unknown as { hubId?: string | null }).hubId ?? null,
              listingVertical: l.listing_vertical ?? null,
            }))}
            onNotice={setStatusBanner}
          />
        ) : (
          <OwnerCapabilityLockCard
            title="Bookings & Stays Desk Locked"
            entitlementLabel="Booking Slots / Hotel Multi-Room"
            description="Accept online slot reservations, room check-ins, and walk-in blocks once Bookings & Stays is enabled on the Business Owner's plan."
            isStaffMode={isStaffMode}
            onUpgradePlan={() => setActiveTab('plans_trials')}
            testId="lock-card-bookings-stays"
          />
        ))}

      {/* TAB: PRINT & DIGITAL SUITE (OWNER FULL / STAFF QUEUE ONLY) */}
      {activeTab === 'print_digital' &&
        (canPrintDigital ? (
          <OwnerPrintManager
            mode={isStaffMode ? 'staff' : 'owner'}
            isStaffMode={isStaffMode}
            listings={accessibleListings.map((l) => ({
              id: l.id,
              title: l.title,
              locality: l.locality,
              hubId: (l as unknown as { hubId?: string | null }).hubId ?? null,
              status: l.status,
              category: l.category,
            }))}
            onNotice={setStatusBanner}
          />
        ) : (
          <OwnerCapabilityLockCard
            title="Print & Digital Orders Suite Locked"
            entitlementLabel="Print Online Orders / Custom Digital Suite"
            description="Receive document print orders, rate-card pricing, and print-shop dispatch controls once enabled on the Business Owner's subscription."
            isStaffMode={isStaffMode}
            onUpgradePlan={() => setActiveTab('plans_trials')}
            testId="lock-card-print-digital"
          />
        ))}

      {/* TAB: LIVE MARKETPLACE CATALOGUE / STAFF STOCK */}
      {activeTab === 'marketplace' && (
        <MarketplaceCatalogueManager
          mode={isStaffMode ? 'staff' : 'owner'}
          listings={accessibleListings}
          entitlementOwnerId={entitlementOwnerId}
          onNotice={setStatusBanner}
        />
      )}

      {/* TAB: OWNER BULLETINS & QUOTA / STAFF SHOP BULLETINS */}
      {activeTab === 'bulletins' && (
        <OwnerBulletinsPanel
          mode={isStaffMode ? 'staff' : 'owner'}
          listings={accessibleListings}
        />
      )}

      {/* TAB: VEHICLES & SCHEDULE CALENDAR (OWNER FLEET) */}
      {activeTab === 'vehicles' && !isStaffMode && (
        <VehicleFleetCalendarManager
          viewMode="both"
          onNotice={(n) =>
            setStatusBanner({
              type: n.type === 'error' ? 'error' : n.type === 'info' ? 'info' : 'success',
              text: n.text,
            })
          }
        />
      )}

      {/* TAB: PLANS, TRIALS & PAY-PER MONETIZATION (OWNER ONLY) */}
      {activeTab === 'plans_trials' && !isStaffMode && (
        <OwnerOverviewAndPlanPanel
          targetOwnerId={entitlementOwnerId}
          activeListingId={entitlementListingId}
          activeBusinessTitle={accessibleListings[0]?.title || null}
          isStaffMode={false}
          fallbackCounts={{
            listingsUsed: accessibleListings.length,
            staffUsed: staffDelegations.filter((d) => d.status === 'active')
              .length,
          }}
          viewMode="plans_and_pay_per"
          onNavigateToSection={handleNavigateFromOverview}
          onNotice={setStatusBanner}
        >
          {canBulletins && (
            <div className="pt-2">
              <OwnerBulletinsPanel
                mode="owner"
                listings={accessibleListings}
              />
            </div>
          )}
        </OwnerOverviewAndPlanPanel>
      )}

      {/* TAB 8: PICK N DROP ESCROW, DISPATCH & FLEET CONSOLE */}
      {activeTab === 'pick_n_drop' &&
        !isStaffMode &&
        (canPndDispatch ? (
          <MediatorDeskRedirectCard
            title="Pick N Drop dispatch runs on the Mediator Desk"
            description="Book deliveries from the Pick N Drop page; escrow, driver dispatch and handover verification are handled by the hub's Dispatch Mediator team."
            href="/pick-n-drop"
            ctaLabel="Book a Pick N Drop delivery"
          />
        ) : (
          <OwnerCapabilityLockCard
            title="Pick N Drop Merchant Dispatch Locked"
            entitlementLabel="Pick N Drop Merchant Dispatch"
            description="Request verified local riders and track escrow dispatch orders once Pick N Drop Dispatch is enabled on your subscription plan."
            isStaffMode={false}
            onUpgradePlan={() => setActiveTab('plans_trials')}
            testId="lock-card-pick-n-drop"
          />
        ))}
      </WorkspaceNavShell>

      {/* RENOVATED MULTI-VERTICAL LISTING EDITOR MODAL */}
      <ListingEditorModal
        isOpen={Boolean(editingListing) || isCreatingModalOpen}
        mode={editingListing && isUuid(editingListing.id) ? 'edit' : 'create'}
        initialListing={editingListing}
        defaultVertical={createModalDefaultVertical}
        isStaffMode={isStaffMode}
        onClose={() => {
          setEditingListing(null);
          setIsCreatingModalOpen(false);
        }}
        onSaved={async (_savedId, savedStatus) => {
          setEditingListing(null);
          setIsCreatingModalOpen(false);
          try {
            const refreshed = await fetchListings(effectiveOwnerId);
            setSupabaseOwnerListings(refreshed);
          } catch {
            // Non-blocking refresh
          }
          setStatusBanner({
            type: 'success',
            text: `Listing saved (${savedStatus.replace(/_/g, ' ')}) and synced to Supabase.`,
          });
        }}
      />

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
      {confirmDialogNode}
    </div>
  );
}
