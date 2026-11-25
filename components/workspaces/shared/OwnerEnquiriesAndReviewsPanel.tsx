'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { FormModal } from '@/components/ui/FormModal';
import { isUuid } from '@/lib/payments/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { EnquiryRecord, Listing, ReviewRecord } from '@/lib/types';

type EnquiryStatus = EnquiryRecord['status'];

export interface OwnerEnquiriesAndReviewsPanelProps {
  view: 'enquiries' | 'reviews';
  listings: Listing[];
  fallbackEnquiries: EnquiryRecord[];
  fallbackReviews: ReviewRecord[];
  isStaffMode: boolean;
  canReplyEnquiry?: (listingId: string) => boolean;
  canReplyReview?: (listingId: string) => boolean;
  onReplyLocalEnquiry: (
    enquiryId: string,
    replyText: string,
    nextStatus: EnquiryStatus
  ) => void;
  onReplyLocalReview: (reviewId: string, replyText: string) => void;
  onReportLocalReview: (reviewId: string, reason: string) => void;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

interface UnifiedEnquiryRow {
  id: string;
  listingId: string;
  listingTitle: string;
  senderName: string;
  senderPhone: string;
  message: string;
  source: string;
  status: EnquiryStatus;
  ownerReply: string;
  createdAt: string;
  isLiveSupabase: boolean;
}

interface UnifiedReviewRow {
  id: string;
  listingId: string;
  listingTitle: string;
  authorName: string;
  rating: number;
  comment: string;
  ownerReply: string;
  verified: boolean;
  reported: boolean;
  createdAt: string;
  isLiveSupabase: boolean;
}

const ENQUIRY_STATUS_OPTIONS: Array<{ value: EnquiryStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
];

export function OwnerEnquiriesAndReviewsPanel({
  view,
  listings,
  fallbackEnquiries,
  fallbackReviews,
  isStaffMode,
  canReplyEnquiry,
  canReplyReview,
  onReplyLocalEnquiry,
  onReplyLocalReview,
  onReportLocalReview,
  onNotice,
}: OwnerEnquiriesAndReviewsPanelProps) {
  const { confirm, dialog: confirmDialogNode } = useConfirmDialogState();

  const [isLoading, setIsLoading] = useState(true);
  const [liveEnquiries, setLiveEnquiries] = useState<UnifiedEnquiryRow[]>([]);
  const [liveReviews, setLiveReviews] = useState<UnifiedReviewRow[]>([]);

  // Enquiry filters & modal state
  const [enquiryStatusFilter, setEnquiryStatusFilter] = useState<string>('all');
  const [expandedEnquiryIds, setExpandedEnquiryIds] = useState<
    Record<string, boolean>
  >({});
  const [activeEnquiryModal, setActiveEnquiryModal] =
    useState<UnifiedEnquiryRow | null>(null);
  const [enquiryReplyText, setEnquiryReplyText] = useState('');
  const [enquiryNextStatus, setEnquiryNextStatus] =
    useState<EnquiryStatus>('resolved');
  const [enquiryTouched, setEnquiryTouched] = useState(false);
  const [enquirySubmitAttempted, setEnquirySubmitAttempted] = useState(false);
  const [isSavingEnquiry, setIsSavingEnquiry] = useState(false);

  // Review filters & modal state
  const [reviewFilter, setReviewFilter] = useState<'all' | 'unreplied' | 'replied'>(
    'all'
  );
  const [activeReviewModal, setActiveReviewModal] =
    useState<UnifiedReviewRow | null>(null);
  const [reviewReplyText, setReviewReplyText] = useState('');
  const [reviewTouched, setReviewTouched] = useState(false);
  const [reviewSubmitAttempted, setReviewSubmitAttempted] = useState(false);
  const [isSavingReview, setIsSavingReview] = useState(false);

  const uuidListingIdsKey = useMemo(
    () =>
      listings
        .map((l) => l.id)
        .filter((id) => isUuid(id))
        .sort()
        .join(','),
    [listings]
  );

  const listingTitleById = useMemo(
    () => new Map(listings.map((l) => [l.id, l.title])),
    [listings]
  );

  const loadLiveRecords = useCallback(async () => {
    const ids = uuidListingIdsKey.split(',').filter(Boolean);
    if (!isSupabaseConfigured() || ids.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      if (view === 'enquiries') {
        const { data, error } = await supabase
          .from('enquiries')
          .select('*')
          .in('listing_id', ids)
          .order('created_at', { ascending: false })
          .limit(100);

        if (!error && Array.isArray(data)) {
          setLiveEnquiries(
            (data as Array<Record<string, unknown>>).map((row) => {
              const lid = String(row.listing_id || '');
              const rawStatus = String(row.status || 'open');
              const normalizedStatus: EnquiryStatus =
                rawStatus === 'resolved' || rawStatus === 'in_progress'
                  ? rawStatus
                  : 'open';
              return {
                id: String(row.id),
                listingId: lid,
                listingTitle:
                  listingTitleById.get(lid) ||
                  String(row.listing_title || 'Listing'),
                senderName: String(
                  row.sender_name || row.customer_name || 'Visitor'
                ),
                senderPhone: String(
                  row.sender_phone || row.customer_phone || 'Not provided'
                ),
                message: String(row.message || ''),
                source: String(row.source || 'listing_page'),
                status: normalizedStatus,
                ownerReply: String(row.owner_reply || row.reply || ''),
                createdAt: String(row.created_at || new Date().toISOString()),
                isLiveSupabase: true,
              };
            })
          );
        }
      } else {
        const { data, error } = await supabase
          .from('reviews')
          .select('*')
          .in('listing_id', ids)
          .order('created_at', { ascending: false })
          .limit(100);

        if (!error && Array.isArray(data)) {
          setLiveReviews(
            (data as Array<Record<string, unknown>>).map((row) => {
              const lid = String(row.listing_id || '');
              return {
                id: String(row.id),
                listingId: lid,
                listingTitle:
                  listingTitleById.get(lid) ||
                  String(row.listing_title || 'Listing'),
                authorName: String(
                  row.author_name || row.reviewer_name || 'Verified Customer'
                ),
                rating: Number(row.rating ?? 5),
                comment: String(row.comment || row.review_text || ''),
                ownerReply: String(row.owner_reply || ''),
                verified: Boolean(row.is_verified ?? row.verified ?? true),
                reported: Boolean(row.is_reported ?? row.reported ?? false),
                createdAt: String(row.created_at || new Date().toISOString()),
                isLiveSupabase: true,
              };
            })
          );
        }
      }
    } catch {
      // Non-blocking fallback to store records
    } finally {
      setIsLoading(false);
    }
  }, [uuidListingIdsKey, view, listingTitleById]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLiveRecords();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLiveRecords]);

  // Merge Supabase records + local fallback records without duplication
  const mergedEnquiries = useMemo<UnifiedEnquiryRow[]>(() => {
    const seen = new Set(liveEnquiries.map((e) => e.id));
    const localRows: UnifiedEnquiryRow[] = fallbackEnquiries
      .filter((e) => !seen.has(e.id))
      .map((e) => ({
        id: e.id,
        listingId: e.listingId,
        listingTitle: e.listingTitle,
        senderName: e.senderName,
        senderPhone: e.senderPhone,
        message: e.message,
        source: e.source,
        status: e.status,
        ownerReply: e.ownerReply || '',
        createdAt: e.createdAt,
        isLiveSupabase: false,
      }));
    return [...liveEnquiries, ...localRows];
  }, [liveEnquiries, fallbackEnquiries]);

  const mergedReviews = useMemo<UnifiedReviewRow[]>(() => {
    const seen = new Set(liveReviews.map((r) => r.id));
    const localRows: UnifiedReviewRow[] = fallbackReviews
      .filter((r) => !seen.has(r.id))
      .map((r) => ({
        id: r.id,
        listingId: r.listingId,
        listingTitle: r.listingTitle,
        authorName: r.authorName,
        rating: r.rating,
        comment: r.comment,
        ownerReply: r.ownerReply || '',
        verified: r.moderationStatus === 'approved',
        reported: Boolean(r.reported),
        createdAt: r.createdAt,
        isLiveSupabase: false,
      }));
    return [...liveReviews, ...localRows];
  }, [liveReviews, fallbackReviews]);

  const filteredEnquiries = useMemo(
    () =>
      mergedEnquiries.filter(
        (e) =>
          enquiryStatusFilter === 'all' || e.status === enquiryStatusFilter
      ),
    [mergedEnquiries, enquiryStatusFilter]
  );

  const filteredReviews = useMemo(
    () =>
      mergedReviews.filter((r) => {
        if (reviewFilter === 'replied') return r.ownerReply.trim().length > 0;
        if (reviewFilter === 'unreplied') return r.ownerReply.trim().length === 0;
        return true;
      }),
    [mergedReviews, reviewFilter]
  );

  const openEnquiryModal = (enq: UnifiedEnquiryRow) => {
    if (isStaffMode && canReplyEnquiry && !canReplyEnquiry(enq.listingId)) {
      onNotice?.({
        type: 'error',
        text: 'Delegated Staff Restriction: Missing "Reply Enquiries" permission for this listing.',
      });
      return;
    }
    setActiveEnquiryModal(enq);
    setEnquiryReplyText(enq.ownerReply || '');
    setEnquiryNextStatus(enq.status === 'open' ? 'resolved' : enq.status);
    setEnquiryTouched(false);
    setEnquirySubmitAttempted(false);
  };

  const enquiryValidationError = useMemo(() => {
    const trimmed = enquiryReplyText.trim();
    if (trimmed.length < 3) {
      return 'Please enter a response of at least 3 characters before saving.';
    }
    if (trimmed.length > 1000) {
      return 'Reply must be 1,000 characters or fewer.';
    }
    return null;
  }, [enquiryReplyText]);

  const handleSaveEnquiryReply = async () => {
    if (!activeEnquiryModal || enquiryValidationError) return;
    setIsSavingEnquiry(true);
    try {
      const trimmed = enquiryReplyText.trim();
      if (activeEnquiryModal.isLiveSupabase && isUuid(activeEnquiryModal.id)) {
        const { error } = await supabase
          .from('enquiries')
          .update({
            status: enquiryNextStatus,
            owner_reply: trimmed,
          })
          .eq('id', activeEnquiryModal.id);
        if (error) {
          // Fallback if owner_reply column isn't present in older schema
          const { error: statusOnlyErr } = await supabase
            .from('enquiries')
            .update({ status: enquiryNextStatus })
            .eq('id', activeEnquiryModal.id);
          if (statusOnlyErr) throw new Error(statusOnlyErr.message);
        }
        setLiveEnquiries((prev) =>
          prev.map((row) =>
            row.id === activeEnquiryModal.id
              ? { ...row, ownerReply: trimmed, status: enquiryNextStatus }
              : row
          )
        );
      } else {
        onReplyLocalEnquiry(activeEnquiryModal.id, trimmed, enquiryNextStatus);
      }

      onNotice?.({
        type: 'success',
        text: `Saved response for ${activeEnquiryModal.senderName} and marked as ${enquiryNextStatus.replace(/_/g, ' ')}.`,
      });
      setActiveEnquiryModal(null);
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to update customer enquiry.',
      });
    } finally {
      setIsSavingEnquiry(false);
    }
  };

  const openReviewModal = (rev: UnifiedReviewRow) => {
    if (isStaffMode && canReplyReview && !canReplyReview(rev.listingId)) {
      onNotice?.({
        type: 'error',
        text: 'Delegated Staff Restriction: Missing "Reply Reviews" permission for this listing.',
      });
      return;
    }
    setActiveReviewModal(rev);
    setReviewReplyText(rev.ownerReply || '');
    setReviewTouched(false);
    setReviewSubmitAttempted(false);
  };

  const reviewValidationError = useMemo(() => {
    const trimmed = reviewReplyText.trim();
    if (trimmed.length < 5) {
      return 'Public owner reply must be at least 5 characters.';
    }
    if (trimmed.length > 600) {
      return 'Public owner reply must be 600 characters or fewer.';
    }
    return null;
  }, [reviewReplyText]);

  const handleSaveReviewReply = async () => {
    if (!activeReviewModal || reviewValidationError) return;
    setIsSavingReview(true);
    try {
      const trimmed = reviewReplyText.trim();
      if (activeReviewModal.isLiveSupabase && isUuid(activeReviewModal.id)) {
        const { error } = await supabase
          .from('reviews')
          .update({ owner_reply: trimmed })
          .eq('id', activeReviewModal.id);
        if (error) throw new Error(error.message);
        setLiveReviews((prev) =>
          prev.map((r) =>
            r.id === activeReviewModal.id ? { ...r, ownerReply: trimmed } : r
          )
        );
      } else {
        onReplyLocalReview(activeReviewModal.id, trimmed);
      }
      onNotice?.({
        type: 'success',
        text: `Published official reply on ${activeReviewModal.authorName}'s review.`,
      });
      setActiveReviewModal(null);
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Unable to save review reply.',
      });
    } finally {
      setIsSavingReview(false);
    }
  };

  const handleFlagReview = async (rev: UnifiedReviewRow) => {
    const accepted = await confirm({
      title: `Flag Review by ${rev.authorName}?`,
      description:
        'Send this review to the Admin Moderation Centre for policy verification. Owners and staff cannot directly alter or delete visitor reviews.',
      caution:
        'Only flag reviews that contain spam, abusive language, or demonstrably false impersonation.',
      confirmLabel: 'Flag for Moderation',
      variant: 'warning',
    });
    if (!accepted) return;

    if (!rev.isLiveSupabase) {
      onReportLocalReview(rev.id, 'Flagged by business owner/staff');
    } else {
      setLiveReviews((prev) =>
        prev.map((r) => (r.id === rev.id ? { ...r, reported: true } : r))
      );
    }
    onNotice?.({
      type: 'info',
      text: `Flagged review by ${rev.authorName} for Admin Moderation Centre.`,
    });
  };

  if (view === 'enquiries') {
    return (
      <section
        data-testid="owner-enquiries-panel"
        className="space-y-4 w-full min-w-0 max-w-full overflow-x-clip"
      >
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Customer Enquiries ({mergedEnquiries.length})
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Respond to incoming customer enquiries across your{' '}
                {isStaffMode ? 'assigned' : 'owned'} listings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadLiveRecords()}
              aria-label="Refresh enquiries"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { id: 'all', label: `All (${mergedEnquiries.length})` },
              {
                id: 'open',
                label: `Open (${mergedEnquiries.filter((e) => e.status === 'open').length})`,
              },
              {
                id: 'in_progress',
                label: `In Progress (${mergedEnquiries.filter((e) => e.status === 'in_progress').length})`,
              },
              {
                id: 'resolved',
                label: `Resolved (${mergedEnquiries.filter((e) => e.status === 'resolved').length})`,
              },
            ].map((pill) => {
              const active = enquiryStatusFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setEnquiryStatusFilter(pill.id)}
                  className={`inline-flex shrink-0 min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2"
              >
                <div className="h-4 w-44 rounded dd-shimmer" />
                <div className="h-3 w-full rounded dd-shimmer" />
                <div className="h-3 w-2/3 rounded dd-shimmer" />
              </div>
            ))}
          </div>
        ) : filteredEnquiries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
            <MessageSquare className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
            <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
              No enquiries in this status
            </p>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Incoming leads and customer questions will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredEnquiries.map((enq) => {
              const isExpanded = Boolean(expandedEnquiryIds[enq.id]);
              return (
                <article
                  key={enq.id}
                  data-testid={`enquiry-card-${enq.id}`}
                  className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shadow-xs"
                >
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[var(--ps-text)]">
                          {enq.senderName}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase ${
                            enq.status === 'resolved'
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : enq.status === 'in_progress'
                                ? 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                : 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {enq.status === 'resolved' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          <span>{enq.status.replace(/_/g, ' ')}</span>
                        </span>
                        <span className="text-[11px] font-semibold text-[var(--ps-accent)]">
                          {enq.listingTitle}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--ps-text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {enq.senderPhone}
                        </span>
                        <span>
                          {enq.createdAt.replace('T', ' ').slice(0, 16)}
                        </span>
                      </div>

                      <p
                        className={`rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] ${
                          isExpanded ? '' : 'line-clamp-2'
                        }`}
                      >
                        {enq.message}
                      </p>

                      {enq.ownerReply && (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-2.5 text-xs text-[var(--ps-text)]">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            Saved Business Reply
                          </span>
                          <p className="mt-0.5">{enq.ownerReply}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedEnquiryIds((prev) => ({
                            ...prev,
                            [enq.id]: !prev[enq.id],
                          }))
                        }
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        <span>{isExpanded ? 'Less' : 'Details'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEnquiryModal(enq)}
                        data-testid={`open-enquiry-reply-${enq.id}`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>
                          {enq.ownerReply ? 'Update Reply' : 'Reply & Status'}
                        </span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Enquiry Reply FormModal */}
        <FormModal
          isOpen={Boolean(activeEnquiryModal)}
          title={
            activeEnquiryModal
              ? `Reply to ${activeEnquiryModal.senderName}`
              : 'Reply to Enquiry'
          }
          subtitle={
            activeEnquiryModal
              ? `${activeEnquiryModal.listingTitle} · ${activeEnquiryModal.senderPhone}`
              : undefined
          }
          hints={[
            'Updating status to Resolved keeps your enquiry inbox clean and logs your response.',
          ]}
          isDirty={
            Boolean(activeEnquiryModal) &&
            (enquiryReplyText !== (activeEnquiryModal?.ownerReply || '') ||
              enquiryNextStatus !== activeEnquiryModal?.status)
          }
          isValid={!enquiryValidationError}
          validationSummary={
            enquirySubmitAttempted && enquiryValidationError
              ? [enquiryValidationError]
              : []
          }
          onSubmitAttempt={() => {
            setEnquiryTouched(true);
            setEnquirySubmitAttempted(true);
          }}
          submitLabel="Save Reply & Update Status"
          confirmSubmitTitle="Save Enquiry Response?"
          confirmSubmitDescription="Record this response and update the customer enquiry status."
          confirmSubmitImpact={[
            `Customer: ${activeEnquiryModal?.senderName || ''}`,
            `New Status: ${enquiryNextStatus.replace(/_/g, ' ')}`,
          ]}
          isSubmitting={isSavingEnquiry}
          onSubmit={handleSaveEnquiryReply}
          onClose={() => setActiveEnquiryModal(null)}
        >
          {activeEnquiryModal && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-xs text-[var(--ps-text)]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Customer Message
                </div>
                <p className="mt-1 leading-relaxed">
                  {activeEnquiryModal.message}
                </p>
              </div>

              <div>
                <CustomSelectModal
                  label="Enquiry Status *"
                  value={enquiryNextStatus}
                  onChange={(val) => setEnquiryNextStatus(val as EnquiryStatus)}
                  options={ENQUIRY_STATUS_OPTIONS}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ps-text)]">
                  Your Response *
                </label>
                <textarea
                  rows={4}
                  value={enquiryReplyText}
                  onChange={(e) => {
                    setEnquiryReplyText(e.target.value);
                    setEnquiryTouched(true);
                  }}
                  onBlur={() => setEnquiryTouched(true)}
                  placeholder="Write a clear, helpful reply with pricing, availability, or callback timing..."
                  className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                />
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  {(enquiryTouched || enquirySubmitAttempted) &&
                  enquiryValidationError ? (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {enquiryValidationError}
                    </span>
                  ) : (
                    <span className="text-[var(--ps-text-muted)]">
                      Saved directly to the enquiry record.
                    </span>
                  )}
                  <span className="font-mono text-[var(--ps-text-muted)]">
                    {enquiryReplyText.trim().length}/1000
                  </span>
                </div>
              </div>
            </div>
          )}
        </FormModal>

        {confirmDialogNode}
      </section>
    );
  }

  // VIEW === 'reviews'
  return (
    <section
      data-testid="owner-reviews-panel"
      className="space-y-4 w-full min-w-0 max-w-full overflow-x-clip"
    >
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Customer Reviews &amp; Official Replies ({mergedReviews.length})
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Business owners and authorized staff can publish official responses or flag policy violations, but can never edit or delete visitor reviews.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadLiveRecords()}
            aria-label="Refresh reviews"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {(
            [
              { id: 'all', label: `All (${mergedReviews.length})` },
              {
                id: 'unreplied',
                label: `Needs Reply (${mergedReviews.filter((r) => !r.ownerReply.trim()).length})`,
              },
              {
                id: 'replied',
                label: `Replied (${mergedReviews.filter((r) => Boolean(r.ownerReply.trim())).length})`,
              },
            ] as const
          ).map((pill) => {
            const active = reviewFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setReviewFilter(pill.id)}
                className={`inline-flex shrink-0 min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  active
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2"
            >
              <div className="h-4 w-40 rounded dd-shimmer" />
              <div className="h-3 w-full rounded dd-shimmer" />
            </div>
          ))}
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <Star className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
            No customer reviews match this filter
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReviews.map((rev) => (
            <article
              key={rev.id}
              data-testid={`review-card-${rev.id}`}
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3 shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[var(--ps-accent)]">
                    {rev.listingTitle}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[var(--ps-text)]">
                      {rev.authorName}
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                      <Star className="h-3 w-3 fill-amber-400" />
                      {rev.rating}.0
                    </span>
                    {rev.verified && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />
                        Verified Customer
                      </span>
                    )}
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      {rev.createdAt.slice(0, 10)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={rev.reported}
                    onClick={() => void handleFlagReview(rev)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-60 cursor-pointer"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span>{rev.reported ? 'Flagged' : 'Report'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openReviewModal(rev)}
                    data-testid={`open-review-reply-${rev.id}`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>
                      {rev.ownerReply ? 'Edit Public Reply' : 'Post Public Reply'}
                    </span>
                  </button>
                </div>
              </div>

              <p className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] leading-relaxed">
                &ldquo;{rev.comment}&rdquo;
              </p>

              {rev.ownerReply && (
                <div className="rounded-xl border border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/8 p-3 text-xs text-[var(--ps-text)]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                    Public Business Reply
                  </div>
                  <p className="mt-1">{rev.ownerReply}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Review Reply FormModal */}
      <FormModal
        isOpen={Boolean(activeReviewModal)}
        title={
          activeReviewModal?.ownerReply
            ? 'Edit Official Public Reply'
            : 'Post Official Public Reply'
        }
        subtitle={
          activeReviewModal
            ? `${activeReviewModal.listingTitle} · Review by ${activeReviewModal.authorName} (${activeReviewModal.rating}.0 ★)`
            : undefined
        }
        cautions={[
          'Replies are publicly visible on your listing page alongside the customer review.',
        ]}
        hints={[
          'Keep responses courteous and factual (5–600 characters). You can update your reply anytime.',
        ]}
        isDirty={
          Boolean(activeReviewModal) &&
          reviewReplyText !== (activeReviewModal?.ownerReply || '')
        }
        isValid={!reviewValidationError}
        validationSummary={
          reviewSubmitAttempted && reviewValidationError
            ? [reviewValidationError]
            : []
        }
        onSubmitAttempt={() => {
          setReviewTouched(true);
          setReviewSubmitAttempted(true);
        }}
        submitLabel="Publish Official Reply"
        confirmSubmitTitle="Publish Public Owner Reply?"
        confirmSubmitDescription="Your reply will be displayed publicly on your listing detail page."
        confirmSubmitCaution="Replies are publicly visible on your listing."
        isSubmitting={isSavingReview}
        onSubmit={handleSaveReviewReply}
        onClose={() => setActiveReviewModal(null)}
      >
        {activeReviewModal && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-xs text-[var(--ps-text)]">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <span>Customer Review</span>
                <span className="text-amber-500">
                  {activeReviewModal.rating}.0 ★
                </span>
              </div>
              <p className="mt-1 italic">&ldquo;{activeReviewModal.comment}&rdquo;</p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--ps-text)]">
                Official Business Reply *
              </label>
              <textarea
                rows={4}
                value={reviewReplyText}
                onChange={(e) => {
                  setReviewReplyText(e.target.value);
                  setReviewTouched(true);
                }}
                onBlur={() => setReviewTouched(true)}
                placeholder="Thank you for visiting! We appreciate your feedback..."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              <div className="mt-1 flex items-center justify-between text-[11px]">
                {(reviewTouched || reviewSubmitAttempted) &&
                reviewValidationError ? (
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {reviewValidationError}
                  </span>
                ) : (
                  <span className="text-[var(--ps-text-muted)]">
                    Publicly visible on your listing storefront.
                  </span>
                )}
                <span className="font-mono text-[var(--ps-text-muted)]">
                  {reviewReplyText.trim().length}/600
                </span>
              </div>
            </div>
          </div>
        )}
      </FormModal>

      {confirmDialogNode}
    </section>
  );
}

export default OwnerEnquiriesAndReviewsPanel;
