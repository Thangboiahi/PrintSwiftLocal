'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, CalendarDays, ChevronDown, Edit3, Home, Layers, Loader2, MapPin, Printer, ShoppingBag, Store, Trash2 } from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { ActivityFeed } from '@/components/shared/ActivityFeed';
import { ArchiveBusinessModal } from '@/components/workspaces/ArchiveBusinessModal';
import { OwnerEntitlementBanner } from '@/components/workspaces/OwnerEntitlementBanner';
import { VehicleFleetCalendarManager } from '@/components/workspaces/VehicleFleetCalendarManager';
import { OwnerBookingManager } from '@/components/workspaces/bookings/OwnerBookingManager';
import { OwnerCommerceManager } from '@/components/workspaces/commerce/OwnerCommerceManager';
import { OwnerPrintManager } from '@/components/workspaces/print/OwnerPrintManager';
import { OwnerRealEstateManager } from '@/components/workspaces/real-estate/OwnerRealEstateManager';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
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
            .select(
              'id, title, category, listing_vertical, lifecycle_status, locality, status, owner_id, hub_id'
            )
            .eq('owner_id', resolvedOwnerId)
            .order('updated_at', { ascending: false });

          if (!active) return;

          if (!error && Array.isArray(data)) {
            setOwnerListings(
              data.map((row) => {
                const rec = row as Record<string, unknown>;
                return {
                  id: String(rec.id || ''),
                  title: String(rec.title || 'Untitled Listing'),
                  category: String(
                    rec.category || 'business'
                  ) as ListingCategory,
                  listingVertical: String(rec.listing_vertical || 'general'),
                  lifecycleStatus: String(rec.lifecycle_status || 'active'),
                  locality: String(rec.locality || 'Churachandpur'),
                  status: String(rec.status || 'draft'),
                  ownerId: String(rec.owner_id || resolvedOwnerId),
                  hubId: rec.hub_id ? String(rec.hub_id) : null,
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
          }))
      );
      setIsLoading(false);
    }

    void loadOwnerListings();

    return () => {
      active = false;
    };
  }, [authUser?.id, currentUser.id, storeListings]);

  const handleDelete = async (row: OwnerListingRow) => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${row.title}"? This action cannot be undone.`
    );
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
      setStatusMessage({
        type: 'success',
        text: `Deleted listing "${row.title}".`,
      });
    } catch (err) {
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
      className="min-w-0 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-5 shadow-sm space-y-4"
    >
      {/* Pass R5: Multi-Business Active Switcher + Composable Entitlements Banner */}
      {ownerListings.length > 0 && activeBusiness && (
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
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
          <p className="text-xs text-[var(--ps-text-muted)]">
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
          className="flex flex-wrap items-center gap-1.5"
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
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
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
          minWidthClass="min-w-[560px]"
          showSwipeHint={true}
          swipeHintLabel="Swipe ↔ to view listing details and actions"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2.5 px-3">Listing</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70 dark:divide-gray-800/70">
              {filteredListings.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--ps-bg)]/60">
                  <td className="py-3 px-3">
                    <div className="font-semibold text-[var(--ps-text)]">
                      {row.title}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>{row.locality}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="inline-block rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                      {CATEGORY_LABELS[row.category] || row.category}
                    </span>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="inline-block rounded border border-gray-200 dark:border-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--ps-text-muted)]">
                      {String(row.status).replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {onEditListing ? (
                        <button
                          type="button"
                          onClick={() => onEditListing(row.id)}
                          data-testid={`owner-crud-edit-${row.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                      ) : (
                        <Link
                          href={`/listing/${encodeURIComponent(row.id)}`}
                          data-testid={`owner-crud-edit-${row.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </Link>
                      )}
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
              ))}
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
    </section>
  );
}

export default OwnerWorkspace;
