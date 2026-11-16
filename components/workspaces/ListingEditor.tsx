'use client';

import React, { useState } from 'react';
import { ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import type { Listing } from '@/lib/types';

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
  children?: React.ReactNode;
}

export function ListingEditor({
  listing,
  authenticatedUserId,
  userRole,
  isDeleting = false,
  onDeleteListing,
  onTransferOwnership,
  children,
}: ListingEditorProps) {
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [targetOwnerId, setTargetOwnerId] = useState('');
  const [targetOwnerName, setTargetOwnerName] = useState('');

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

  return (
    <div
      data-testid="listing-editor-role-guard"
      className="space-y-4"
    >
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

          <span className="text-xs text-[var(--ps-text-muted)]">
            {canPerformDestructive
              ? `Owner ID (${listing.ownerId}) verified — full update, ownership transfer, and delete privileges active.`
              : 'Delegated Staff mode — update permissions active; destructive actions (Delete / Transfer Ownership) are disabled.'}
          </span>
        </div>

        {/* Destructive Actions: Strictly visible ONLY when authenticatedUserId === listing.ownerId or role === 'super_admin' */}
        {canPerformDestructive && (
          <div className="flex flex-wrap items-center gap-2">
            {onTransferOwnership && (
              <button
                type="button"
                data-testid="editor-transfer-ownership-btn"
                onClick={() => setIsTransferOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-300"
              >
                <UserCheck className="h-3.5 w-3.5" />
                Transfer Ownership
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting ? 'Deleting…' : 'Delete Listing'}
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
            Reassign <code className="font-mono">owner_id</code> to another registered user profile. Once transferred, only the new owner (or a Super Admin) will retain destructive permissions.
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
    </div>
  );
}

export default ListingEditor;
