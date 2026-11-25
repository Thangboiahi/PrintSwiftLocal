'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Edit3,
  Eye,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { PayPerCheckoutModal } from '@/components/monetization/PayPerCheckoutModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { CompletenessIndicator } from '@/components/shared/CompletenessIndicator';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  CANONICAL_LISTING_SYSTEM_ROOTS,
  getCategoryBreadcrumbPath,
  resolveListingRootKey,
} from '@/lib/taxonomy/categories';
import type { Listing, ListingStatus } from '@/lib/types';

export interface OwnerListingsPortfolioPanelProps {
  listings: Listing[];
  isLoading?: boolean;
  isStaffMode: boolean;
  hasAutoVerifyPlan?: boolean;
  canEditListing?: (listingId: string) => boolean;
  onCreateNew: () => void;
  onOpenImport?: () => void;
  onEditListing: (listing: Listing) => void;
  onPreviewListing: (listing: Listing) => void;
  onLocateOnMap: (listingId: string) => void;
  onDuplicateListing?: (listing: Listing) => void;
  onArchiveListing: (listing: Listing) => Promise<void> | void;
  onResubmitListing: (listing: Listing) => Promise<void> | void;
  onDeleteListing: (listing: Listing) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

interface PendingCategoryInfo {
  id: string;
  display_name: string;
  review_status: string;
}

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All Statuses' },
  { id: 'live', label: 'Approved / Live' },
  { id: 'pending', label: 'Pending Review' },
  { id: 'changes_requested', label: 'Changes Requested' },
  { id: 'draft', label: 'Drafts' },
  { id: 'archived', label: 'Archived' },
];

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getPaymentModeLabel(mode?: 'upi' | 'manual' | 'both' | string): {
  label: string;
  tone: string;
} {
  if (mode === 'upi') {
    return {
      label: 'UPI Only',
      tone: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    };
  }
  if (mode === 'manual') {
    return {
      label: 'Counter / Cash',
      tone: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  }
  return {
    label: 'UPI + Counter',
    tone: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  };
}

function getVerificationBadge(
  listing: Listing,
  hasAutoVerifyPlan: boolean
): { label: string; tone: string; isAutoVerified: boolean } {
  const isLive =
    listing.status === 'published' ||
    (listing.status as string) === 'approved';
  const isAutoVerified = Boolean(
    isLive && hasAutoVerifyPlan && listing.is_verified
  );

  if (isAutoVerified) {
    return {
      label: 'Auto-Verified via Plan',
      tone: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      isAutoVerified: true,
    };
  }
  if (isLive) {
    return {
      label: 'Approved',
      tone: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      isAutoVerified: false,
    };
  }
  if (listing.status === 'changes_requested') {
    return {
      label: 'Changes Requested',
      tone: 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300',
      isAutoVerified: false,
    };
  }
  if (
    listing.status === 'submitted' ||
    listing.status === 'pending_verification'
  ) {
    return {
      label: 'Pending Review',
      tone: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      isAutoVerified: false,
    };
  }
  if (listing.status === 'rejected' || listing.status === 'suspended') {
    return {
      label: listing.status === 'rejected' ? 'Rejected' : 'Suspended',
      tone: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      isAutoVerified: false,
    };
  }
  if (
    listing.status === 'archived' ||
    listing.lifecycle_status === 'archived_by_owner'
  ) {
    return {
      label: 'Archived',
      tone: 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]',
      isAutoVerified: false,
    };
  }
  return {
    label: 'Draft',
    tone: 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]',
    isAutoVerified: false,
  };
}

function getPayPerModuleForListing(
  listing: Listing
): 'real_estate_rent' | 'real_estate_sale' {
  const sub = String(listing.subcategory || '').toLowerCase();
  if (sub.includes('rent') || sub.includes('lease') || sub.includes('pg')) {
    return 'real_estate_rent';
  }
  return 'real_estate_sale';
}

export function OwnerListingsPortfolioPanel({
  listings,
  isLoading = false,
  isStaffMode,
  hasAutoVerifyPlan = false,
  canEditListing,
  onCreateNew,
  onOpenImport,
  onEditListing,
  onPreviewListing,
  onLocateOnMap,
  onDuplicateListing,
  onArchiveListing,
  onResubmitListing,
  onDeleteListing,
  onRefresh,
  onNotice,
}: OwnerListingsPortfolioPanelProps) {
  const { config } = useAppConfig();
  const { confirm, dialog: confirmDialogNode } = useConfirmDialogState();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rootFilter, setRootFilter] = useState<string>('all');
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>(
    {}
  );
  const [pendingCategoriesById, setPendingCategoriesById] = useState<
    Record<string, PendingCategoryInfo>
  >({});
  const [renewTarget, setRenewTarget] = useState<Listing | null>(null);
  const [busyListingId, setBusyListingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [listings.length]);

  // Fetch any pending_review user-suggested categories referenced by these listings
  const categoryIdsSignature = useMemo(
    () =>
      Array.from(
        new Set(
          listings
            .map((l) => l.category_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
      )
        .sort()
        .join(','),
    [listings]
  );

  useEffect(() => {
    if (!categoryIdsSignature || !isSupabaseConfigured()) return;
    let active = true;
    const ids = categoryIdsSignature.split(',').filter(Boolean);

    const loadPendingCats = async () => {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select('id, display_name, review_status')
          .in('id', ids)
          .eq('review_status', 'pending_review');
        if (!active || error || !Array.isArray(data)) return;
        const map: Record<string, PendingCategoryInfo> = {};
        for (const row of data as PendingCategoryInfo[]) {
          map[row.id] = row;
        }
        setPendingCategoriesById(map);
      } catch {
        // Non-blocking fallback
      }
    };

    void loadPendingCats();
    return () => {
      active = false;
    };
  }, [categoryIdsSignature]);

  const categoriesFlat = config.categoriesFlat;

  const enrichedListings = useMemo(() => {
    return listings.map((listing) => {
      const rootKey = resolveListingRootKey(
        listing.root_key || listing.listing_vertical,
        listing.category,
        listing.is_civic_record
      );
      const rootMeta = CANONICAL_LISTING_SYSTEM_ROOTS.find(
        (r) => r.root_key === rootKey
      );
      const trail = getCategoryBreadcrumbPath(
        categoriesFlat,
        listing.category_id || listing.subcategory || rootKey,
        'listing'
      );
      const pendingCat = listing.category_id
        ? pendingCategoriesById[listing.category_id]
        : undefined;

      const breadcrumbParts: string[] = [];
      if (trail.length > 0) {
        for (const node of trail) {
          breadcrumbParts.push(node.display_name || node.slug);
        }
      } else {
        breadcrumbParts.push(rootMeta?.label || rootKey.replace(/_/g, ' '));
        if (
          listing.subcategory &&
          listing.subcategory.toLowerCase() !== 'general'
        ) {
          breadcrumbParts.push(listing.subcategory);
        }
      }
      if (
        pendingCat &&
        !breadcrumbParts.some(
          (p) => p.toLowerCase() === pendingCat.display_name.toLowerCase()
        )
      ) {
        breadcrumbParts.push(pendingCat.display_name);
      }

      const paidUntilMs = listing.paid_until
        ? Date.parse(listing.paid_until)
        : NaN;
      const hasPaidUntil = Number.isFinite(paidUntilMs);
      const isPayPerExpired = hasPaidUntil && nowMs > 0 && paidUntilMs <= nowMs;
      const isPayPerExpiringSoon =
        hasPaidUntil &&
        nowMs > 0 &&
        paidUntilMs > nowMs &&
        paidUntilMs - nowMs <= 7 * 86400 * 1000;

      return {
        listing,
        rootKey,
        rootLabel: rootMeta?.label || rootKey.replace(/_/g, ' '),
        breadcrumb: breadcrumbParts.join(' → '),
        isSuggestedLeafPending: Boolean(pendingCat),
        hasPaidUntil,
        isPayPerExpired,
        isPayPerExpiringSoon,
      };
    });
  }, [listings, categoriesFlat, pendingCategoriesById, nowMs]);

  const filteredListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedListings.filter((item) => {
      const { listing, rootKey, breadcrumb } = item;

      if (rootFilter !== 'all' && rootKey !== rootFilter) return false;

      if (statusFilter === 'live') {
        if (
          listing.status !== 'published' &&
          (listing.status as string) !== 'approved'
        ) {
          return false;
        }
      } else if (statusFilter === 'pending') {
        if (
          listing.status !== 'submitted' &&
          listing.status !== 'pending_verification'
        ) {
          return false;
        }
      } else if (statusFilter === 'changes_requested') {
        if (listing.status !== 'changes_requested') return false;
      } else if (statusFilter === 'draft') {
        if (listing.status !== 'draft') return false;
      } else if (statusFilter === 'archived') {
        if (
          listing.status !== 'archived' &&
          listing.lifecycle_status !== 'archived_by_owner'
        ) {
          return false;
        }
      }

      if (q) {
        const hay = `${listing.title} ${listing.locality} ${breadcrumb} ${listing.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedListings, rootFilter, statusFilter, searchQuery]);

  const availableRoots = useMemo(() => {
    const present = new Set<string>(enrichedListings.map((i) => String(i.rootKey)));
    return CANONICAL_LISTING_SYSTEM_ROOTS.filter((r) =>
      present.has(r.root_key)
    );
  }, [enrichedListings]);

  const toggleCardExpanded = (id: string) => {
    setExpandedCardIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleConfirmArchive = async (listing: Listing) => {
    if (isStaffMode) return;
    const isAlreadyArchived =
      listing.status === 'archived' ||
      listing.lifecycle_status === 'archived_by_owner';
    const accepted = await confirm({
      title: isAlreadyArchived
        ? `Republish "${listing.title}" as Draft?`
        : `Archive / Unpublish "${listing.title}"?`,
      description: isAlreadyArchived
        ? 'Restores this listing to draft status so you can review and publish it again.'
        : 'Hides this listing from public discovery immediately while preserving all reviews, bookings history, and media.',
      caution: isAlreadyArchived
        ? undefined
        : 'Customers will no longer see this listing on Explore or Search until republished.',
      impactSummary: [
        `Listing: ${listing.title}`,
        `Locality: ${listing.locality}`,
      ],
      confirmLabel: isAlreadyArchived ? 'Restore to Draft' : 'Archive Listing',
      variant: 'warning',
    });
    if (!accepted) return;
    setBusyListingId(listing.id);
    try {
      await onArchiveListing(listing);
    } finally {
      setBusyListingId(null);
    }
  };

  const handleConfirmResubmit = async (listing: Listing) => {
    const accepted = await confirm({
      title: `Resubmit "${listing.title}" for Review?`,
      description:
        'Sends your updated listing details back to the moderation queue (or publishes instantly if Auto-Verified via your Plan).',
      impactSummary: [
        `Listing: ${listing.title}`,
        `Current Status: ${listing.status.replace(/_/g, ' ')}`,
      ],
      confirmLabel: 'Submit for Review',
      variant: 'info',
    });
    if (!accepted) return;
    setBusyListingId(listing.id);
    try {
      await onResubmitListing(listing);
    } finally {
      setBusyListingId(null);
    }
  };

  const handleConfirmDelete = async (listing: Listing) => {
    if (isStaffMode) return;
    const accepted = await confirm({
      title: `Permanently Delete "${listing.title}"?`,
      description:
        'This permanently deletes the listing record from Supabase. This action cannot be undone.',
      caution:
        'If you only want to pause operations temporarily, choose Archive / Unpublish instead.',
      impactSummary: [
        `Listing: ${listing.title}`,
        `Locality: ${listing.locality}`,
      ],
      confirmLabel: 'Delete Permanently',
      variant: 'danger',
    });
    if (!accepted) return;
    setBusyListingId(listing.id);
    try {
      await onDeleteListing(listing);
    } finally {
      setBusyListingId(null);
    }
  };

  return (
    <section
      data-testid="owner-listings-portfolio-panel"
      className="space-y-4 w-full min-w-0 max-w-full overflow-x-clip"
    >
      {/* Header & Controls */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3.5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              {isStaffMode
                ? `Assigned Business Listings (${listings.length})`
                : `My Listings & Properties (${listings.length})`}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              {isStaffMode
                ? 'Edit permitted operational details, hours, pricing, and media for your delegated listings. Deletion and billing remain owner-only.'
                : 'Manage listings across all 8 verticals with live taxonomy breadcrumbs, verification badges, payment rail status, and Pay-Per renewal.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={() => void onRefresh()}
                aria-label="Refresh listings"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            {!isStaffMode && onOpenImport && (
              <button
                type="button"
                onClick={onOpenImport}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Import XLSX/CSV</span>
              </button>
            )}
            {!isStaffMode && (
              <button
                type="button"
                onClick={onCreateNew}
                data-testid="portfolio-create-listing-btn"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Add New Listing</span>
              </button>
            )}
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by listing title, locality, L1 → L2 → L3 category, or status..."
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-4 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
        </div>

        {/* Horizontal Scrollable Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {STATUS_FILTERS.map((st) => {
            const active = statusFilter === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={`inline-flex shrink-0 min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                }`}
              >
                {st.label}
              </button>
            );
          })}
        </div>

        {/* Horizontal Scrollable L1 Root Filter Pills */}
        {availableRoots.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-[var(--ps-border)] pt-2.5">
            <button
              type="button"
              onClick={() => setRootFilter('all')}
              className={`inline-flex shrink-0 min-h-[38px] items-center rounded-lg border px-2.5 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                rootFilter === 'all'
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              All Verticals ({listings.length})
            </button>
            {availableRoots.map((root) => {
              const active = rootFilter === root.root_key;
              return (
                <button
                  key={root.root_key}
                  type="button"
                  onClick={() => setRootFilter(root.root_key)}
                  className={`inline-flex shrink-0 min-h-[38px] items-center rounded-lg border px-2.5 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {root.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Loading Skeletons (.dd-shimmer) */}
      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading listings">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-48 rounded-md dd-shimmer" />
                  <div className="h-3 w-72 max-w-full rounded-md dd-shimmer" />
                </div>
                <div className="h-8 w-24 rounded-lg dd-shimmer" />
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="h-6 w-28 rounded-lg dd-shimmer" />
                <div className="h-6 w-24 rounded-lg dd-shimmer" />
                <div className="h-6 w-32 rounded-lg dd-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <p className="text-sm font-bold text-[var(--ps-text)]">
            No matching listings found
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            {listings.length === 0
              ? isStaffMode
                ? 'You have no active delegated business listings yet.'
                : 'Create your first listing to appear on Churachandpur Local Discovery & Maps.'
              : 'Try adjusting your status filter, vertical pill, or search keyword.'}
          </p>
          {!isStaffMode && listings.length === 0 && (
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create First Listing</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* DESKTOP (lg+): Clean Multi-Column Table */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="px-4 py-3">Listing &amp; Taxonomy</th>
                  <th className="px-4 py-3">Verification &amp; Rails</th>
                  <th className="px-4 py-3">Pay-Per / Completeness</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)] text-xs">
                {filteredListings.map((entry) => {
                  const {
                    listing,
                    breadcrumb,
                    isSuggestedLeafPending,
                    hasPaidUntil,
                    isPayPerExpired,
                    isPayPerExpiringSoon,
                  } = entry;
                  const verBadge = getVerificationBadge(
                    listing,
                    hasAutoVerifyPlan
                  );
                  const payBadge = getPaymentModeLabel(listing.payment_mode);
                  const isBusy = busyListingId === listing.id;
                  const canEdit = canEditListing
                    ? canEditListing(listing.id)
                    : true;
                  const canResubmit =
                    listing.status === 'draft' ||
                    listing.status === 'changes_requested' ||
                    listing.status === 'rejected';

                  return (
                    <tr
                      key={listing.id}
                      data-testid={`portfolio-row-${listing.id}`}
                      className="hover:bg-[var(--ps-surface-alt)]/50 transition-colors"
                    >
                      <td className="px-4 py-3.5 align-top max-w-[320px]">
                        <div className="font-bold text-sm text-[var(--ps-text)] truncate">
                          {listing.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--ps-text-muted)] truncate">
                          {listing.locality}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ps-text-muted)]">
                            {breadcrumb}
                          </span>
                          {isSuggestedLeafPending && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                              <Clock className="h-3 w-3" />
                              Pending Superadmin Review
                            </span>
                          )}
                        </div>
                        {listing.changeRequestNote && (
                          <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            Note: {listing.changeRequestNote}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <div className="flex flex-col items-start gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${verBadge.tone}`}
                          >
                            {verBadge.isAutoVerified ? (
                              <Sparkles className="h-3 w-3" />
                            ) : (
                              <ShieldCheck className="h-3 w-3" />
                            )}
                            <span>{verBadge.label}</span>
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] font-semibold ${payBadge.tone}`}
                          >
                            {listing.payment_mode === 'manual' ? (
                              <Wallet className="h-3 w-3" />
                            ) : (
                              <CreditCard className="h-3 w-3" />
                            )}
                            <span>{payBadge.label}</span>
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 align-top space-y-2">
                        <CompletenessIndicator listing={listing} compact />
                        {hasPaidUntil && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] font-bold ${
                                isPayPerExpired
                                  ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                                  : isPayPerExpiringSoon
                                    ? 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                    : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              <Ticket className="h-3 w-3" />
                              <span>
                                {isPayPerExpired
                                  ? 'Expired — Hidden Publicly'
                                  : `Active until ${formatShortDate(listing.paid_until)}`}
                              </span>
                            </span>
                            {!isStaffMode &&
                              (isPayPerExpired || isPayPerExpiringSoon) && (
                                <button
                                  type="button"
                                  onClick={() => setRenewTarget(listing)}
                                  className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-[var(--ps-accent)] px-2.5 text-[10.5px] font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                                >
                                  <Ticket className="h-3 w-3" />
                                  <span>Renew Pay-Per</span>
                                </button>
                              )}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canEdit && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => onEditListing(listing)}
                              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Edit</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onPreviewListing(listing)}
                            title="Preview Public Page"
                            aria-label={`Preview ${listing.title}`}
                            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            data-testid={`owner-locate-on-map-${listing.id}`}
                            onClick={() => onLocateOnMap(listing.id)}
                            title="Locate on Discovery Map"
                            aria-label={`Locate ${listing.title} on Map`}
                            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                          </button>
                          {canResubmit && canEdit && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleConfirmResubmit(listing)}
                              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2.5 text-xs font-semibold text-sky-700 dark:text-sky-300 cursor-pointer"
                            >
                              <Send className="h-3.5 w-3.5" />
                              <span>Resubmit</span>
                            </button>
                          )}
                          {!isStaffMode && onDuplicateListing && (
                            <button
                              type="button"
                              onClick={() => onDuplicateListing(listing)}
                              title="Duplicate as Draft"
                              aria-label={`Duplicate ${listing.title}`}
                              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!isStaffMode && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleConfirmArchive(listing)}
                                title="Archive or Unpublish Listing"
                                aria-label={`Archive ${listing.title}`}
                                className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                data-testid={`owner-delete-listing-${listing.id}`}
                                onClick={() => void handleConfirmDelete(listing)}
                                title="Delete Listing Permanently"
                                aria-label={`Delete ${listing.title}`}
                                className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE & TABLET (< lg): Stacked Collapsible Cards */}
          <div className="lg:hidden space-y-2.5">
            {filteredListings.map((entry) => {
              const {
                listing,
                breadcrumb,
                isSuggestedLeafPending,
                hasPaidUntil,
                isPayPerExpired,
                isPayPerExpiringSoon,
              } = entry;
              const verBadge = getVerificationBadge(listing, hasAutoVerifyPlan);
              const payBadge = getPaymentModeLabel(listing.payment_mode);
              const isExpanded = Boolean(expandedCardIds[listing.id]);
              const isBusy = busyListingId === listing.id;
              const canEdit = canEditListing
                ? canEditListing(listing.id)
                : true;
              const canResubmit =
                listing.status === 'draft' ||
                listing.status === 'changes_requested' ||
                listing.status === 'rejected';

              return (
                <article
                  key={listing.id}
                  data-testid={`portfolio-card-${listing.id}`}
                  className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shadow-xs"
                >
                  <button
                    type="button"
                    onClick={() => toggleCardExpanded(listing.id)}
                    aria-expanded={isExpanded}
                    className="flex w-full min-h-[60px] items-start justify-between gap-3 p-3.5 text-left cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-[var(--ps-text)] truncate max-w-full">
                          {listing.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {listing.locality} · {breadcrumb}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-bold ${verBadge.tone}`}
                        >
                          {verBadge.isAutoVerified ? (
                            <Sparkles className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          <span>{verBadge.label}</span>
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${payBadge.tone}`}
                        >
                          {payBadge.label}
                        </span>
                        {isSuggestedLeafPending && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            Pending Superadmin Review
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/50 p-3.5 space-y-3">
                      <CompletenessIndicator listing={listing} />

                      {listing.changeRequestNote && (
                        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                          <strong>Moderator Note:</strong>{' '}
                          {listing.changeRequestNote}
                        </div>
                      )}

                      {hasPaidUntil && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5">
                          <span
                            className={`text-xs font-bold ${
                              isPayPerExpired
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {isPayPerExpired
                              ? 'Expired — Hidden Publicly'
                              : `Pay-Per Active until ${formatShortDate(listing.paid_until)}`}
                          </span>
                          {!isStaffMode &&
                            (isPayPerExpired || isPayPerExpiringSoon) && (
                              <button
                                type="button"
                                onClick={() => setRenewTarget(listing)}
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                              >
                                <Ticket className="h-3.5 w-3.5" />
                                <span>Renew Pay-Per</span>
                              </button>
                            )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {canEdit && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onEditListing(listing)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit Listing</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onPreviewListing(listing)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Preview</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onLocateOnMap(listing.id)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          <span>Map Pin</span>
                        </button>
                        {canResubmit && canEdit && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleConfirmResubmit(listing)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 dark:text-sky-300 cursor-pointer"
                          >
                            <Send className="h-3.5 w-3.5" />
                            <span>Resubmit</span>
                          </button>
                        )}
                        {!isStaffMode && (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleConfirmArchive(listing)}
                              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-700 dark:text-amber-300 cursor-pointer"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              <span>Archive</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleConfirmDelete(listing)}
                              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 text-xs font-semibold text-rose-600 dark:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* 1-Tap Pay-Per Renewal Modal (Owners Only) */}
      {!isStaffMode && renewTarget && (
        <PayPerCheckoutModal
          open={Boolean(renewTarget)}
          onClose={() => setRenewTarget(null)}
          moduleKey={getPayPerModuleForListing(renewTarget)}
          targetTable="listings"
          targetId={renewTarget.id}
          targetTitle={renewTarget.title}
          onSuccess={(payload) => {
            onNotice?.({
              type: 'success',
              text: `Submitted ₹${payload.amountInr} Pay-Per renewal (${payload.durationDays} days) for "${renewTarget.title}". Pending Superadmin verification.`,
            });
            setRenewTarget(null);
            void onRefresh?.();
          }}
        />
      )}

      {confirmDialogNode}
    </section>
  );
}

export default OwnerListingsPortfolioPanel;
