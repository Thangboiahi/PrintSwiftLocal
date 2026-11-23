'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';

interface ReviewQueueItem {
  id: string;
  title: string;
  hub_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  listing_vertical: string;
  subcategory: string;
  locality: string;
  status: string;
  is_verified: boolean;
  logo_url: string | null;
  cover_image: string | null;
  change_request_note: string | null;
  updated_at: string | null;
}

export interface ListingReviewsPanelProps {
  hubId?: string | null;
  onReviewCompleted?: () => void;
}

export function ListingReviewsPanel({
  hubId,
  onReviewCompleted,
}: ListingReviewsPanelProps) {
  const { session } = useAuth();
  const { setStatus } = useAppStatus();

  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'queue' | 'all_unverified'>(
    'queue'
  );
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    item: ReviewQueueItem;
    action: 'approve' | 'request_changes' | 'reject';
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadQueue = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase
        .from('listings')
        .select(
          'id, title, hub_id, owner_id, owner_name, listing_vertical, subcategory, locality, status, is_verified, logo_url, cover_image, change_request_note, updated_at'
        )
        .order('updated_at', { ascending: false })
        .limit(60);

      if (hubId) {
        query = query.eq('hub_id', hubId);
      }
      if (statusFilter === 'queue') {
        query = query.in('status', [
          'pending_verification',
          'pending',
          'submitted',
          'changes_requested',
        ]);
      } else {
        query = query.eq('is_verified', false);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      setItems((data || []) as ReviewQueueItem[]);
    } catch (err) {
      setNotice({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to load listing verification queue.',
      });
    } finally {
      setLoading(false);
    }
  }, [hubId, statusFilter]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const executeReviewConfirmed = async () => {
    if (!pendingConfirm || isProcessing) return;
    setIsProcessing(true);
    setStatus('saving');
    setNotice(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch('/api/listings/review', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          listingId: pendingConfirm.item.id,
          action: pendingConfirm.action,
          reviewerNotes: notesById[pendingConfirm.item.id] || '',
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        deletedFilesCount?: number;
      } | null;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Listing moderation failed.');
      }

      setStatus('success');
      setNotice({
        type: 'ok',
        text:
          pendingConfirm.action === 'approve'
            ? `Approved "${pendingConfirm.item.title}" and promoted uploaded media to permanent storage.`
            : pendingConfirm.action === 'reject'
            ? `Rejected "${pendingConfirm.item.title}". ${
                json.deletedFilesCount || 0
              } unapproved media file(s) hard-deleted and owner notified.`
            : `Requested changes for "${pendingConfirm.item.title}" and notified owner.`,
      });
      setPendingConfirm(null);
      await loadQueue();
      onReviewCompleted?.();
    } catch (err) {
      setStatus('error');
      setNotice({
        type: 'err',
        text:
          err instanceof Error ? err.message : 'Failed to process review.',
      });
      setPendingConfirm(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--ps-accent)]" />
            Listing Verification &amp; Media Approval Queue
          </h3>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Approving promotes pending 14-day media into permanent storage.
            Rejecting hard-deletes unapproved Storage objects and notifies the
            owner.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('queue')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
              statusFilter === 'queue'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)]'
            }`}
          >
            Pending Review
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all_unverified')}
            className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
              statusFilter === 'all_unverified'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)]'
            }`}
          >
            All Unverified
          </button>
          <button
            type="button"
            onClick={() => void loadQueue()}
            disabled={loading}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs ${
            notice.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading listing verification queue...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center text-xs text-[var(--ps-text-muted)]">
          No listings awaiting verification right now.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const thumb = resolveRemoteMediaUrl(
              item.logo_url || item.cover_image || ''
            );
            return (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden shrink-0 flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <MapPin className="w-5 h-5 text-[var(--ps-text-muted)]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[var(--ps-text)] truncate">
                          {item.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] uppercase">
                          {(item.listing_vertical || 'general').replace(/_/g, ' ')}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-300">
                          {item.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                        {item.subcategory} • {item.locality} • Owner:{' '}
                        {item.owner_name || 'Partner'}
                      </p>
                      <a
                        href={`/explore?listing=${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline mt-1"
                      >
                        Inspect on Explore <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={notesById[item.id] || ''}
                    onChange={(e) =>
                      setNotesById((prev) => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    placeholder="Optional reviewer note / rejection reason..."
                    className="flex-1 px-3 py-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPendingConfirm({ item, action: 'approve' })
                      }
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingConfirm({ item, action: 'request_changes' })
                      }
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-bold cursor-pointer"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Request Changes
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingConfirm({ item, action: 'reject' })
                      }
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject &amp; Purge Media
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmActionModal
        isOpen={Boolean(pendingConfirm)}
        variant={pendingConfirm?.action === 'reject' ? 'danger' : 'default'}
        title={
          pendingConfirm?.action === 'approve'
            ? `Approve "${pendingConfirm.item.title}"?`
            : pendingConfirm?.action === 'reject'
            ? `Reject "${pendingConfirm?.item.title}" & Purge Pending Media?`
            : `Request Changes for "${pendingConfirm?.item.title}"?`
        }
        description={
          pendingConfirm?.action === 'approve'
            ? 'Sets listing verified & published and promotes its temporary 14-day media uploads into permanent storage.'
            : pendingConfirm?.action === 'reject'
            ? 'Hard-deletes unapproved uploaded files from Supabase Storage & media_assets, scrubs URLs, and notifies the owner.'
            : 'Sends your feedback note to the listing owner so they can update and resubmit.'
        }
        confirmLabel={
          pendingConfirm?.action === 'approve'
            ? 'Confirm Approval'
            : pendingConfirm?.action === 'reject'
            ? 'Confirm Reject & Delete Media'
            : 'Send Request'
        }
        loading={isProcessing}
        onConfirm={() => void executeReviewConfirmed()}
        onCancel={() => {
          if (!isProcessing) setPendingConfirm(null);
        }}
      />
    </div>
  );
}
