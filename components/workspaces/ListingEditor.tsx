'use client';

import React, { useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Layers,
  Loader2,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { ArchiveBusinessModal } from '@/components/workspaces/ArchiveBusinessModal';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { bindEntityMedia } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';

const OWNER_VERTICAL_OPTIONS: CustomSelectOption[] = [
  { value: 'general', label: 'General Business' },
  { value: 'print_digital', label: 'Print & Digital' },
  { value: 'booking_venue', label: 'Turf / Hall / Booking Venue' },
  { value: 'hotel_stay', label: 'Hotel / Homestay' },
  { value: 'shop_catalogue', label: 'Shop & Catalogue' },
  { value: 'restaurant_food', label: 'Restaurant & Café' },
  { value: 'real_estate', label: 'Real Estate / Property' },
];

export async function initializeDefaultVerticalProfile(
  listingId: string,
  hubId: string | null | undefined,
  vertical: ListingVertical
): Promise<void> {
  if (!isSupabaseConfigured() || !listingId) return;
  try {
    if (vertical === 'print_digital') {
      await supabase
        .from('listing_print_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId || null,
            is_accepting_orders: true,
          },
          { onConflict: 'listing_id', ignoreDuplicates: true }
        );
    } else if (vertical === 'hotel_stay') {
      await supabase
        .from('listing_hotel_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId || null,
            check_in_time: '13:00',
            check_out_time: '11:00',
          },
          { onConflict: 'listing_id', ignoreDuplicates: true }
        );
    } else if (vertical === 'shop_catalogue') {
      await supabase
        .from('listing_shop_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId || null,
            is_accepting_orders: true,
            supports_counter_pickup: true,
            supports_pick_n_drop: true,
          },
          { onConflict: 'listing_id', ignoreDuplicates: true }
        );
    } else if (vertical === 'restaurant_food') {
      await supabase
        .from('listing_restaurant_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId || null,
            is_accepting_orders: true,
            is_kitchen_paused: false,
            prep_time_mins: 25,
          },
          { onConflict: 'listing_id', ignoreDuplicates: true }
        );
    } else if (vertical === 'real_estate') {
      await supabase
        .from('listing_real_estate_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId || null,
            transaction_type: 'rent',
            price_inr: 0,
            price_period: 'monthly',
            show_exact_pin: true,
          },
          { onConflict: 'listing_id', ignoreDuplicates: true }
        );
    }
  } catch {
    // Non-blocking best-effort auto-init
  }
}

export function canUserPerformDestructiveListingAction(
  listing: Pick<Listing, 'ownerId'> | null | undefined,
  authenticatedUserId?: string | null,
  role?: string | null
): boolean {
  if (!listing) return false;
  const normalizedRole = String(role || '')
    .trim()
    .toLowerCase();

  if (normalizedRole === 'staff') {
    return false;
  }

  if (normalizedRole === 'super_admin') {
    return true;
  }

  const cleanUserId = String(authenticatedUserId || '').trim();
  const cleanOwnerId = String(listing.ownerId || '').trim();
  if (!cleanUserId || !cleanOwnerId) {
    return false;
  }

  return cleanUserId === cleanOwnerId;
}

export function isStaffDelegatedAccess(
  listing: Pick<Listing, 'ownerId' | 'assignedStaffIds'> | null | undefined,
  authenticatedUserId?: string | null,
  role?: string | null
): boolean {
  const normalizedRole = String(role || '')
    .trim()
    .toLowerCase();
  if (normalizedRole === 'staff') {
    return true;
  }
  if (!listing || !authenticatedUserId) {
    return false;
  }
  return (
    listing.ownerId !== authenticatedUserId &&
    Array.isArray(listing.assignedStaffIds) &&
    listing.assignedStaffIds.includes(authenticatedUserId)
  );
}

export interface ListingEditorProps {
  listing: Listing;
  authenticatedUserId?: string | null;
  userRole?: string | null;
  isDeleting?: boolean;
  onDeleteListing?: (listing: Listing) => void | Promise<void>;
  onTransferOwnership?: (
    listing: Listing,
    newOwnerId: string,
    newOwnerName?: string
  ) => void | Promise<void>;
  onVerticalChanged?: (vertical: ListingVertical) => void;
  onLifecycleUpdated?: (newStatus: string) => void;
  children?: React.ReactNode;
}

export function ListingEditor({
  listing,
  authenticatedUserId,
  userRole,
  isDeleting = false,
  onDeleteListing,
  onTransferOwnership,
  onVerticalChanged,
  onLifecycleUpdated,
  children,
}: ListingEditorProps) {
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [targetOwnerId, setTargetOwnerId] = useState('');
  const [targetOwnerName, setTargetOwnerName] = useState('');

  const [selectedVertical, setSelectedVertical] = useState<ListingVertical>(
    listing.listing_vertical || 'general'
  );
  const [isVerticalModalOpen, setIsVerticalModalOpen] = useState(false);
  const [isSavingVertical, setIsSavingVertical] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [lifecycleStatus, setLifecycleStatus] = useState<string>(
    listing.lifecycle_status || 'active'
  );

  const canPerformDestructive = canUserPerformDestructiveListingAction(
    listing,
    authenticatedUserId,
    userRole
  );
  const isStaffAccess = isStaffDelegatedAccess(
    listing,
    authenticatedUserId,
    userRole
  );
  const isAdminRole =
    String(userRole || '').toLowerCase() === 'super_admin' ||
    String(userRole || '').toLowerCase() === 'admin';

  const verticalOptions: CustomSelectOption[] = isAdminRole
    ? [
        ...OWNER_VERTICAL_OPTIONS,
        { value: 'public_civic', label: 'Public & Civic (Admin Only)' },
      ]
    : OWNER_VERTICAL_OPTIONS;

  const activeVerticalLabel =
    verticalOptions.find((o) => o.value === selectedVertical)?.label ||
    'General Business';

  const handleSaveVertical = async (nextVal: string) => {
    const nextVertical = nextVal as ListingVertical;
    setSelectedVertical(nextVertical);
    setIsVerticalModalOpen(false);
    if (!isSupabaseConfigured()) {
      onVerticalChanged?.(nextVertical);
      return;
    }

    setIsSavingVertical(true);
    setAppStatus('saving', 'Updating business vertical & desk…');
    try {
      const { error } = await supabase
        .from('listings')
        .update({ listing_vertical: nextVertical })
        .eq('id', listing.id);
      if (error) {
        throw new Error(error.message);
      }

      // Auto-init default vertical profile row if not yet created
      await initializeDefaultVerticalProfile(
        listing.id,
        listing.hub_id,
        nextVertical
      );

      // Bind existing cover & gallery media via zero-orphan registry
      if (listing.coverImage) {
        void bindEntityMedia(
          [listing.coverImage],
          'listing_cover',
          listing.id,
          'permanent_bound'
        );
      }
      if (Array.isArray(listing.galleryImages) && listing.galleryImages.length > 0) {
        void bindEntityMedia(
          listing.galleryImages,
          'listing_gallery',
          listing.id,
          'permanent_bound'
        );
      }

      setAppStatus('success', `Vertical set to ${activeVerticalLabel}`);
      onVerticalChanged?.(nextVertical);
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to update business vertical.'
      );
    } finally {
      setIsSavingVertical(false);
    }
  };

  return (
    <div data-testid="listing-editor-role-guard" className="space-y-4">
      {/* Role & Ownership Permission Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {isStaffAccess ? (
            <span
              data-testid="staff-access-badge"
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Staff Access
            </span>
          ) : canPerformDestructive ? (
            <span
              data-testid="owner-access-badge"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {String(userRole || '').toLowerCase() === 'super_admin'
                ? 'Super Admin Full Access'
                : 'Verified Listing Owner'}
            </span>
          ) : (
            <span
              data-testid="staff-access-badge"
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Staff Access
            </span>
          )}

          {/* Lifecycle Status Pill */}
          <span
            data-testid="editor-lifecycle-pill"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              lifecycleStatus === 'active'
                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                : lifecycleStatus === 'draining'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {lifecycleStatus.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Owner / Super-Admin Actions (Strictly hidden from Staff!) */}
        {canPerformDestructive && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Business Vertical Selector */}
            <div className="min-w-[180px]">
              <CustomSelectModal
                testId="editor-vertical-select-btn"
                disabled={isSavingVertical}
                options={verticalOptions}
                value={selectedVertical}
                onChange={(val) => void handleSaveVertical(val)}
                placeholder="Select Vertical"
              />
            </div>

            <button
              type="button"
              data-testid="editor-archive-business-btn"
              onClick={() => setIsArchiveModalOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-300 cursor-pointer"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Pause / Archive</span>
            </button>

            {onTransferOwnership && (
              <button
                type="button"
                data-testid="editor-transfer-ownership-btn"
                onClick={() => setIsTransferOpen((prev) => !prev)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-300 cursor-pointer"
              >
                <UserCheck className="h-3.5 w-3.5" />
                Transfer
              </button>
            )}

            {onDeleteListing && (
              <button
                type="button"
                data-testid="editor-delete-listing-btn"
                disabled={isDeleting}
                onClick={() => {
                  void onDeleteListing(listing);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Inline Transfer Ownership Form (Owner / Super Admin Only) */}
      {canPerformDestructive && isTransferOpen && onTransferOwnership && (
        <div
          data-testid="transfer-ownership-panel"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5"
        >
          <div className="text-xs font-bold text-[var(--ps-text)]">
            Transfer Listing Ownership
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Reassign <code className="font-mono">owner_id</code> to another registered user profile.
          </p>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              data-testid="transfer-owner-id-input"
              value={targetOwnerId}
              onChange={(e) => setTargetOwnerId(e.target.value)}
              placeholder="New Owner Profile UUID / ID"
              className="flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 font-mono text-xs text-[var(--ps-text)]"
            />
            <input
              type="text"
              data-testid="transfer-owner-name-input"
              value={targetOwnerName}
              onChange={(e) => setTargetOwnerName(e.target.value)}
              placeholder="New Owner Display Name (optional)"
              className="flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs text-[var(--ps-text)]"
            />
            <button
              type="button"
              data-testid="confirm-transfer-ownership-btn"
              disabled={!targetOwnerId.trim()}
              onClick={() => {
                if (!targetOwnerId.trim()) return;
                void onTransferOwnership(
                  listing,
                  targetOwnerId.trim(),
                  targetOwnerName.trim() || undefined
                );
                setIsTransferOpen(false);
                setTargetOwnerId('');
                setTargetOwnerName('');
              }}
              className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm Transfer
            </button>
          </div>
        </div>
      )}

      {children}

      {/* Safe Pause / Archive Business Modal (z-[90]) */}
      <ArchiveBusinessModal
        open={isArchiveModalOpen}
        listingId={listing.id}
        listingTitle={listing.title}
        currentLifecycleStatus={lifecycleStatus}
        onClose={() => setIsArchiveModalOpen(false)}
        onLifecycleUpdated={(nextStatus) => {
          setLifecycleStatus(nextStatus);
          onLifecycleUpdated?.(nextStatus);
        }}
      />
    </div>
  );
}

export {
  ListingEditorModal,
  type ListingEditorModalProps,
} from './shared/ListingEditorModal';

export default ListingEditor;
