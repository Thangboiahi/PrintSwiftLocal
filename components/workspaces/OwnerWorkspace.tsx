'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Edit3, Loader2, MapPin, Trash2 } from 'lucide-react';
import { ActivityFeed } from '@/components/shared/ActivityFeed';
import { VehicleFleetCalendarManager } from '@/components/workspaces/VehicleFleetCalendarManager';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { Listing, ListingCategory, ListingStatus } from '@/lib/types';

interface OwnerListingRow {
  id: string;
  title: string;
  category: ListingCategory;
  locality: string;
  status: ListingStatus | string;
  ownerId: string;
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
            .select('id, title, category, locality, status, owner_id')
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
                  locality: String(rec.locality || 'Churachandpur'),
                  status: String(rec.status || 'draft'),
                  ownerId: String(rec.owner_id || resolvedOwnerId),
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

  return (
    <section
      data-testid="owner-workspace-crud"
      className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-5 shadow-sm space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            My Owned Listings ({ownerListings.length})
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Manage listings where your account is the verified owner.
          </p>
        </div>
      </div>

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

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--ps-text-muted)] gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
          <span>Loading owned listings…</span>
        </div>
      ) : ownerListings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
          No listings found for your owner account yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2.5 pr-4">Listing</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 pl-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70 dark:divide-gray-800/70">
              {ownerListings.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--ps-bg)]/60">
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-[var(--ps-text)]">
                      {row.title}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>{row.locality}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-block rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                      {CATEGORY_LABELS[row.category] || row.category}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-block rounded border border-gray-200 dark:border-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--ps-text-muted)]">
                      {String(row.status).replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {onEditListing ? (
                        <button
                          type="button"
                          onClick={() => onEditListing(row.id)}
                          data-testid={`owner-crud-edit-${row.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
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
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
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
        </div>
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
    </section>
  );
}

export default OwnerWorkspace;
