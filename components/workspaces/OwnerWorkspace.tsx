'use client';

import React, { useEffect, useState } from 'react';
import { Archive, CalendarDays, CheckCircle2, ChevronDown, Edit3, Home, Layers, Loader2, MapPin, Plus, Printer, ShoppingBag, Store, Trash2 } from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { ActivityFeed } from '@/components/shared/ActivityFeed';
import { CompletenessIndicator } from '@/components/shared/CompletenessIndicator';
import { ArchiveBusinessModal } from '@/components/workspaces/ArchiveBusinessModal';
import { ListingEditorModal } from '@/components/workspaces/ListingEditor';
import { OwnerEntitlementBanner } from '@/components/workspaces/OwnerEntitlementBanner';
import { VehicleFleetCalendarManager } from '@/components/workspaces/VehicleFleetCalendarManager';
import { OwnerBookingManager } from '@/components/workspaces/bookings/OwnerBookingManager';
import { OwnerCommerceManager } from '@/components/workspaces/commerce/OwnerCommerceManager';
import { OwnerPrintManager } from '@/components/workspaces/print/OwnerPrintManager';
import { OwnerRealEstateManager } from '@/components/workspaces/real-estate/OwnerRealEstateManager';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore, useAuth } from '@/lib/store';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { mapRowToListing, type SupabaseListingRow } from '@/lib/supabase/listings';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import { Listing, ListingCategory, ListingStatus } from '@/lib/types';

interface OwnerListingRow {
  id: string;
  title: string;
  category: ListingCategory;
  listingVertical: string;
  lifecycleStatus: string;
  locality: string;
  status: ListingStatus | string;
  ownerId: string;
  hubId?: string | null;
  logoUrl?: string | null;
  coverImage?: string;
  isVerified?: boolean;
  fullListing: Listing;
}

export interface OwnerWorkspaceProps {
  onEditListing?: (listingId: string) => void;
}

export function OwnerWorkspace({ onEditListing }: OwnerWorkspaceProps) {
  const {
    currentUser,
    listings: storeListings,
    notifications,
    changeListingStatus,
  } = useAppStore();
  const { user: authUser } = useAuth();

  const [ownerListings, setOwnerListings] = useState<OwnerListingRow[]>([]);
  const [currentOwnerId, setCurrentOwnerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [editorState, setEditorState] = useState<{
    isOpen: boolean;
    mode: 'create' | 'edit';
    listing: Listing | null;
  }>({ isOpen: false, mode: 'create', listing: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  useEffect(() => {
    let active = true;

    async function loadOwnerListings() {
      let resolvedOwnerId = authUser?.id || currentUser.id;

      if (isSupabaseConfigured()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (session?.user?.id) {
            resolvedOwnerId = session.user.id;
          }

          if (active) {
            setCurrentOwnerId(resolvedOwnerId);
          }

          const { data, error } = await supabase
            .from('listings')
            .select('*')
            .eq('owner_id', resolvedOwnerId)
            .order('updated_at', { ascending: false });

          if (!active) return;

          if (!error && Array.isArray(data)) {
            setOwnerListings(
              data.map((row) => {
                const mapped = mapRowToListing(row as SupabaseListingRow);
                const rec = row as Record<string, unknown>;
                const resolvedLogo = resolveRemoteMediaUrl(
                  String(rec.logo_url || mapped.logo_url || '')
                );
                return {
                  id: mapped.id,
                  title: mapped.title,
                  category: mapped.category,
                  listingVertical: mapped.listing_vertical || 'general',
                  lifecycleStatus: mapped.lifecycle_status || 'active',
                  locality: mapped.locality,
                  status: mapped.status,
                  ownerId: mapped.ownerId || resolvedOwnerId,
                  hubId: mapped.hub_id ?? null,
                  logoUrl: resolvedLogo || null,
                  coverImage: mapped.coverImage,
                  isVerified: Boolean(
                    rec.is_verified ||
                      mapped.is_verified ||
                      mapped.verificationStatus === 'verified_demo'
                  ),
                  fullListing: mapped,
                };
              })
            );
            setIsLoading(false);
            return;
          }
        } catch {
          // Fall back to local store listings below
        }
      }

      if (!active) return;
      setCurrentOwnerId(resolvedOwnerId);
      setOwnerListings(
        storeListings
          .filter((item: Listing) => item.ownerId === resolvedOwnerId)
          .map((item: Listing) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            listingVertical: item.listing_vertical || 'general',
            lifecycleStatus: item.lifecycle_status || 'active',
            locality: item.locality,
            status: item.status,
            ownerId: item.ownerId,
            hubId: item.hub_id ?? null,
            logoUrl: item.logo_url ?? null,
            coverImage: item.coverImage,
            isVerified: Boolean(
              item.is_verified || item.verificationStatus === 'verified_demo'
            ),
            fullListing: item,
          }))
      );
      setIsLoading(false);
    }

    void loadOwnerListings();

    return () => {
      active = false;
    };
  }, [authUser?.id, currentUser.id, storeListings, refreshTick]);

  const handleDelete = async (row: OwnerListingRow) => {
    const confirmed = await confirm({
      title: `Delete "${row.title}"?`,
      description: 'This will permanently delete the listing and cannot be undone.',
      confirmLabel: 'Delete Permanently',
      cancelLabel: 'Keep Listing',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeletingId(row.id);
    setStatusMessage(null);

    try {
      if (isSupabaseConfigured()) {
        const query = supabase
          .from('listings')
          .delete()
          .eq('id', row.id);

        const { error } = currentOwnerId
          ? await query.eq('owner_id', currentOwnerId)
          : await query;

        if (error) {
          throw new Error(error.message);
        }
      }

      setOwnerListings((prev) => prev.filter((item) => item.id !== row.id));
      changeListingStatus(row.id, 'archived');
      setAppStatus('success', `Deleted listing "${row.title}".`);
      setStatusMessage({
        type: 'success',
        text: `Deleted listing "${row.title}".`,
      });
    } catch (err) {
      setAppStatus('error', `Failed to delete "${row.title}".`);
      setStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to delete "${row.title}".`,
      });
    } finally {
      setDeletingId(null);
    }
  };

  const [workspaceTab, setWorkspaceTab] = useState<
    'listings' | 'shop_kitchen' | 'real_estate' | 'print_digital' | 'bookings_stays'
  >('listings');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeBusinessId, setActiveBusinessId] = useState<string>('');
  const [isBusinessSwitcherOpen, setIsBusinessSwitcherOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<OwnerListingRow | null>(
    null
  );

  const activeBusiness =
    ownerListings.find((b) => b.id === activeBusinessId) ||
    ownerListings[0] ||
    null;

  // Pass V4: Strict composable entitlement & Super-Admin precedence check
  const { can: canUseFeature, loading: entitlementsLoading } =
    useEffectiveEntitlements(currentOwnerId || null, activeBusiness?.id || null);

  const canShopKitchen =
    canUseFeature('shop_basket_checkout') ||
    canUseFeature('restaurant_menu_ordering') ||
    canUseFeature('restaurant_table_booking');
  const canRealEstate = canUseFeature('real_estate_verified_boost');
  const canBookingsStays =
    canUseFeature('booking_slots') || canUseFeature('hotel_multi_room');
  const canPrintDigital =
    canUseFeature('print_online_orders') ||
    canUseFeature('print_custom_digital');

  useEffect(() => {
    if (entitlementsLoading) return;
    if (workspaceTab === 'shop_kitchen' && !canShopKitchen) {
      setWorkspaceTab('listings');
    } else if (workspaceTab === 'real_estate' && !canRealEstate) {
      setWorkspaceTab('listings');
    } else if (workspaceTab === 'bookings_stays' && !canBookingsStays) {
      setWorkspaceTab('listings');
    } else if (workspaceTab === 'print_digital' && !canPrintDigital) {
      setWorkspaceTab('listings');
    }
  }, [
    entitlementsLoading,
    workspaceTab,
    canShopKitchen,
    canRealEstate,
    canBookingsStays,
    canPrintDigital,
  ]);

  const businessSwitcherOptions: CustomSelectOption[] = ownerListings.map(
    (b) => ({
      value: b.id,
      label: `${b.title} (${b.listingVertical.replace(/_/g, ' ')} · ${b.lifecycleStatus})`,
    })
  );

  const filteredListings = ownerListings.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      row.title.toLowerCase().includes(q) ||
      row.locality.toLowerCase().includes(q) ||
      (CATEGORY_LABELS[row.category] || row.category).toLowerCase().includes(q)
    );
  });

  return (
    <section
      data-testid="owner-workspace-crud"
      className="min-w-0 max-w-full overflow-x-clip rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-4 sm:p-5 shadow-sm space-y-4"
    >
      {/* Pass R5: Multi-Business Active Switcher + Composable Entitlements Banner */}
      {ownerListings.length > 0 && activeBusiness && (
        <div
          data-tour="workspace-business-selector"
          className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Store className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
            <span className="text-[var(--ps-text-muted)] font-medium shrink-0">
              Active Business:
            </span>
            <div className="min-w-[200px] max-w-[280px]">
              <CustomSelectModal
                testId="owner-active-business-switcher"
                options={businessSwitcherOptions}
                value={activeBusiness.id}
                onChange={(nextId) => {
                  setActiveBusinessId(nextId);
                  const matched = ownerListings.find((b) => b.id === nextId);
                  if (matched) {
                    if (matched.listingVertical === 'print_digital') {
                      setWorkspaceTab('print_digital');
                    } else if (
                      matched.listingVertical === 'shop_catalogue' ||
                      matched.listingVertical === 'restaurant_food'
                    ) {
                      setWorkspaceTab('shop_kitchen');
                    } else if (
                      matched.listingVertical === 'booking_venue' ||
                      matched.listingVertical === 'hotel_stay'
                    ) {
                      setWorkspaceTab('bookings_stays');
                    } else if (matched.listingVertical === 'real_estate') {
                      setWorkspaceTab('real_estate');
                    }
                  }
                }}
                placeholder="Select Business"
              />
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] text-[10px] font-bold uppercase">
              {activeBusiness.listingVertical.replace(/_/g, ' ')}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                activeBusiness.lifecycleStatus === 'active'
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : activeBusiness.lifecycleStatus === 'draining'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
              }`}
            >
              {activeBusiness.lifecycleStatus.replace(/_/g, ' ')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setArchiveTarget(activeBusiness)}
            className="h-8 px-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-semibold inline-flex items-center gap-1.5 hover:bg-amber-500/20 cursor-pointer shrink-0"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Pause / Archive</span>
          </button>
        </div>
      )}

      {currentOwnerId && (
        <OwnerEntitlementBanner
          userId={currentOwnerId}
          listingId={activeBusiness?.id || null}
          currentListingsCount={
            ownerListings.filter((l) => l.lifecycleStatus === 'active').length
          }
        />
      )}

      {archiveTarget && (
        <ArchiveBusinessModal
          open={Boolean(archiveTarget)}
          listingId={archiveTarget.id}
          listingTitle={archiveTarget.title}
          currentLifecycleStatus={archiveTarget.lifecycleStatus}
          onClose={() => setArchiveTarget(null)}
          onLifecycleUpdated={(nextStatus) => {
            setOwnerListings((prev) =>
              prev.map((item) =>
                item.id === archiveTarget.id
                  ? { ...item, lifecycleStatus: nextStatus }
                  : item
              )
            );
          }}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-gray-200 dark:border-gray-800 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-xl font-bold leading-snug text-[var(--ps-text)] break-words">
            {workspaceTab === 'print_digital'
              ? 'Print & Digital Counter'
              : workspaceTab === 'bookings_stays'
                ? 'Bookings & Stays Desk'
                : workspaceTab === 'shop_kitchen'
                  ? 'Shop & Kitchen Desk'
                  : workspaceTab === 'real_estate'
                    ? 'Real Estate Desk'
                    : `My Owned Listings (${ownerListings.length})`}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ps-text-muted)] line-clamp-2 sm:line-clamp-none">
            {workspaceTab === 'print_digital'
              ? 'Configure Print Pro counter setup, process print orders, and track escrow settlements.'
              : workspaceTab === 'bookings_stays'
                ? 'Manage live slots, walk-in blocks, Check-In OTPs, room inventory, and escrow settlements.'
                : workspaceTab === 'shop_kitchen'
                  ? 'Manage live storefront & kitchen orders, 1-tap stock toggles, table bookings, QR posters, and settlements.'
                  : workspaceTab === 'real_estate'
                    ? 'Manage property specs, 30-day freshness renewal, site visit approvals, and 30-day Verified Boosts.'
                    : 'Manage listings where your account is the verified owner.'}
          </p>
        </div>

        <nav
          aria-label="Owner workspace tabs"
          className="flex w-full max-w-full flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
        >
          <button
            type="button"
            onClick={() => setWorkspaceTab('listings')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              workspaceTab === 'listings'
                ? 'bg-theme-primary text-theme-primary-foreground'
                : 'border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Listings &amp; Fleet</span>
          </button>
          {canShopKitchen && (
            <button
              type="button"
              onClick={() => setWorkspaceTab('shop_kitchen')}
              data-testid="owner-workspace-commerce-tab"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                workspaceTab === 'shop_kitchen'
                  ? 'bg-theme-primary text-theme-primary-foreground'
                  : 'border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>Shop &amp; Kitchen</span>
            </button>
          )}
          {canRealEstate && (
            <button
              type="button"
              onClick={() => setWorkspaceTab('real_estate')}
              data-testid="owner-workspace-real-estate-tab"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                workspaceTab === 'real_estate'
                  ? 'bg-theme-primary text-theme-primary-foreground'
                  : 'border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Home className="h-3.5 w-3.5" />
              <span>Real Estate</span>
            </button>
          )}
          {canBookingsStays && (
            <button
              type="button"
              onClick={() => setWorkspaceTab('bookings_stays')}
              data-testid="owner-workspace-bookings-tab"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                workspaceTab === 'bookings_stays'
                  ? 'bg-theme-primary text-theme-primary-foreground'
                  : 'border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Bookings &amp; Stays</span>
            </button>
          )}
          {canPrintDigital && (
            <button
              type="button"
              onClick={() => setWorkspaceTab('print_digital')}
              data-testid="owner-workspace-print-tab"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                workspaceTab === 'print_digital'
                  ? 'bg-theme-primary text-theme-primary-foreground'
                  : 'border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print &amp; Digital</span>
            </button>
          )}
        </nav>
      </div>

      {workspaceTab === 'real_estate' ? (
        <OwnerRealEstateManager
          listings={ownerListings.map((l) => ({
            id: l.id,
            title: l.title,
            locality: l.locality,
            hubId: l.hubId ?? null,
          }))}
        />
      ) : workspaceTab === 'shop_kitchen' ? (
        <OwnerCommerceManager
          listings={ownerListings.map((l) => ({
            id: l.id,
            title: l.title,
            locality: l.locality,
            hubId: l.hubId ?? null,
          }))}
        />
      ) : workspaceTab === 'bookings_stays' ? (
        <OwnerBookingManager
          listings={ownerListings.map((l) => ({
            id: l.id,
            title: l.title,
            locality: l.locality,
            hubId: l.hubId ?? null,
            listingVertical:
              (l as unknown as { listing_vertical?: string | null })
                .listing_vertical ?? null,
          }))}
          onNotice={(n) =>
            setStatusMessage({
              type: n.type === 'error' ? 'error' : 'success',
              text: n.text,
            })
          }
        />
      ) : workspaceTab === 'print_digital' ? (
        <OwnerPrintManager
          mode="owner"
          listings={ownerListings.map((l) => ({
            id: l.id,
            title: l.title,
            locality: l.locality,
            hubId: l.hubId ?? null,
            status: String(l.status),
            category: l.category,
          }))}
          onNotice={(n) =>
            setStatusMessage({
              type: n.type === 'error' ? 'error' : 'success',
              text: n.text,
            })
          }
        />
      ) : (
        <>

      {statusMessage && (
        <div
          role="status"
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            statusMessage.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Toolbar: Search, Status Filter, Reset, Count */}
      <WorkspaceTableToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search my listings by title, locality…"
        filteredCount={filteredListings.length}
        totalCount={ownerListings.length}
        countLabel="listings"
        hasActiveFilters={Boolean(searchQuery || statusFilter !== 'all')}
        onResetFilters={() => {
          setSearchQuery('');
          setStatusFilter('all');
        }}
      >
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            type="button"
            onClick={() =>
              setEditorState({
                isOpen: true,
                mode: 'create',
                listing: null,
              })
            }
            data-testid="owner-create-listing-btn"
            className="h-7 px-2.5 rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] text-xs font-bold whitespace-nowrap inline-flex items-center gap-1 cursor-pointer shrink-0 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Listing</span>
          </button>
          {[
            { id: 'all', label: 'All' },
            { id: 'published', label: 'Published' },
            { id: 'draft', label: 'Draft' },
            { id: 'pending_verification', label: 'Pending Review' },
            { id: 'archived', label: 'Archived' },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                statusFilter === s.id
                  ? 'bg-theme-primary text-theme-primary-foreground'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-gray-200 dark:border-gray-800 hover:text-[var(--ps-text)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </WorkspaceTableToolbar>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--ps-text-muted)] gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
          <span>Loading owned listings…</span>
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
          {ownerListings.length === 0
            ? 'No listings found for your owner account yet.'
            : 'No listings match the active search or status filters.'}
        </div>
      ) : (
        <ResponsiveTableScroll
          minWidthClass="min-w-[680px]"
          showSwipeHint={true}
          swipeHintLabel="Swipe ↔ to view listing details, completeness, and actions"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2.5 px-3">Listing &amp; Vertical</th>
                <th className="py-2.5 px-3">Verification</th>
                <th className="py-2.5 px-3">Completeness</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70 dark:divide-gray-800/70">
              {filteredListings.map((row) => {
                const thumbSrc = row.logoUrl || row.coverImage || '';
                const statusLower = String(row.status || '').toLowerCase();
                const verificationLabel = row.isVerified
                  ? 'Verified'
                  : statusLower === 'changes_requested'
                  ? 'Changes Requested'
                  : statusLower === 'pending_verification' ||
                    statusLower === 'pending' ||
                    statusLower === 'submitted'
                  ? 'Pending Review'
                  : 'Draft';

                const deskJump: {
                  tab: 'print_digital' | 'shop_kitchen' | 'bookings_stays' | 'real_estate';
                  label: string;
                } | null =
                  row.listingVertical === 'print_digital' && canPrintDigital
                    ? { tab: 'print_digital', label: 'Print Desk' }
                    : (row.listingVertical === 'shop_catalogue' ||
                        row.listingVertical === 'restaurant_food') &&
                      canShopKitchen
                    ? { tab: 'shop_kitchen', label: 'Shop / Kitchen' }
                    : (row.listingVertical === 'booking_venue' ||
                        row.listingVertical === 'hotel_stay') &&
                      canBookingsStays
                    ? { tab: 'bookings_stays', label: 'Bookings' }
                    : row.listingVertical === 'real_estate' && canRealEstate
                    ? { tab: 'real_estate', label: 'Property Desk' }
                    : null;

                return (
                  <tr key={row.id} className="hover:bg-[var(--ps-bg)]/60">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden shrink-0 flex items-center justify-center">
                          {thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={row.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Store className="w-4 h-4 text-[var(--ps-text-muted)]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--ps-text)] truncate max-w-[200px]">
                            {row.title}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                            <span className="inline-flex items-center gap-0.5">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span>{row.locality}</span>
                            </span>
                            <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                              {row.listingVertical.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            row.isVerified
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : statusLower === 'changes_requested'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : statusLower.includes('pending') ||
                                statusLower === 'submitted'
                              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                              : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {row.isVerified && (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                          {verificationLabel}
                        </span>
                        <span className="text-[10px] uppercase text-[var(--ps-text-muted)]">
                          {String(row.status).replace(/_/g, ' ')}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <CompletenessIndicator
                        listing={row.fullListing}
                        compact
                      />
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {deskJump && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveBusinessId(row.id);
                              setWorkspaceTab(deskJump.tab);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-accent)]/20 cursor-pointer"
                          >
                            <span>{deskJump.label}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (onEditListing) {
                              onEditListing(row.id);
                            } else {
                              setEditorState({
                                isOpen: true,
                                mode: 'edit',
                                listing: row.fullListing,
                              });
                            }
                          }}
                          data-testid={`owner-crud-edit-${row.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => void handleDelete(row)}
                          data-testid={`owner-crud-delete-${row.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      )}

      <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
        <VehicleFleetCalendarManager
          viewMode="both"
          onNotice={(n) =>
            setStatusMessage({
              type: n.type === 'error' ? 'error' : 'success',
              text: n.text,
            })
          }
        />
      </div>

      <ActivityFeed
        userId={currentOwnerId}
        title="Owner Activity Feed"
        fallbackItems={notifications.slice(0, 6).map((item) => ({
          id: item.id,
          label: `${item.title}: ${item.message}`,
          timestamp: item.createdAt,
        }))}
      />
        </>
      )}
      {confirmDialog}

      <ListingEditorModal
        isOpen={editorState.isOpen}
        mode={editorState.mode}
        initialListing={editorState.listing}
        onClose={() =>
          setEditorState({ isOpen: false, mode: 'create', listing: null })
        }
        onSaved={(_savedId, savedStatus) => {
          setRefreshTick((t) => t + 1);
          setStatusMessage({
            type: 'success',
            text: `Listing saved (${savedStatus.replace(/_/g, ' ')}) and synced.`,
          });
        }}
      />
    </section>
  );
}

export default OwnerWorkspace;
