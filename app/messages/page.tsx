'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquare,
  Search,
  Send,
} from 'lucide-react';
import { Breadcrumbs, triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import { useAppStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { EnquiryRecord } from '@/lib/types';

export default function MessagesPage() {
  const router = useRouter();
  const { enquiries, listings, replyToEnquiry } = useAppStore();

  const [remoteEnquiries, setRemoteEnquiries] = useState<EnquiryRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replySavedId, setReplySavedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadSupabaseEnquiries = async () => {
      if (!isSupabaseConfigured()) return;
      try {
        const { data } = await supabase
          .from('enquiries')
          .select('*')
          .order('created_at', { ascending: false });

        if (!active || !Array.isArray(data)) return;

        const mapped: EnquiryRecord[] = data.map((row) => {
          const matchedListing = listings.find((l) => l.id === row.listing_id);
          const rawStatus = String(row.status || 'new').toLowerCase();
          const normalizedStatus: EnquiryRecord['status'] =
            rawStatus === 'resolved'
              ? 'resolved'
              : rawStatus === 'in_progress'
                ? 'in_progress'
                : 'open';

          return {
            id: String(row.id),
            listingId: String(row.listing_id),
            listingTitle: matchedListing?.title || 'Lamka Directory Listing',
            ownerId: matchedListing?.ownerId || 'owner-1',
            senderName: String(row.sender_name || 'Visitor'),
            senderPhone: String(row.sender_contact || ''),
            senderEmail: String(row.sender_contact || ''),
            message: String(row.message || ''),
            source: 'Detail Page',
            createdAt: row.created_at
              ? new Date(String(row.created_at)).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : 'Just now',
            status: normalizedStatus,
            activityLog: [],
          };
        });

        setRemoteEnquiries(mapped);
      } catch {
        // Fallback cleanly to local enquiries state
      }
    };

    void loadSupabaseEnquiries();
    return () => {
      active = false;
    };
  }, [listings]);

  const combinedEnquiries = useMemo(() => {
    const seen = new Set<string>();
    const list: EnquiryRecord[] = [];
    for (const item of [...remoteEnquiries, ...enquiries]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        list.push(item);
      }
    }
    return list;
  }, [remoteEnquiries, enquiries]);

  const filteredEnquiries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return combinedEnquiries.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.senderName.toLowerCase().includes(q) ||
        item.listingTitle.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q) ||
        item.senderPhone.toLowerCase().includes(q)
      );
    });
  }, [combinedEnquiries, statusFilter, searchQuery]);

  const handleSendReply = async (enq: EnquiryRecord, nextStatus: EnquiryRecord['status']) => {
    const draft = (replyDrafts[enq.id] ?? enq.ownerReply ?? '').trim();
    if (!draft && nextStatus !== 'resolved') return;

    const replyText = draft || enq.ownerReply || 'Marked resolved by owner.';
    replyToEnquiry(enq.id, replyText, nextStatus);

    if (isSupabaseConfigured()) {
      try {
        const { error: rpcError } = await supabase.rpc('reply_to_enquiry', {
          p_enquiry_id: enq.id,
          p_owner_reply: replyText,
          p_status: nextStatus,
        });
        if (rpcError) {
          await supabase
            .from('enquiries')
            .update({ status: nextStatus, owner_reply: replyText })
            .eq('id', enq.id);
        }
      } catch {
        // Non-blocking fallback
      }
    }

    setRemoteEnquiries((prev) =>
      prev.map((item) =>
        item.id === enq.id
          ? {
              ...item,
              status: nextStatus,
              ownerReply: replyText,
            }
          : item
      )
    );
    setReplySavedId(enq.id);
    setTimeout(() => {
      setReplySavedId((prev) => (prev === enq.id ? null : prev));
    }, 2500);
  };

  return (
    <div
      data-testid="owner-messaging-center-page"
      className="min-h-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Top Bar with Breadcrumbs and Return to Map */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Breadcrumbs items={[{ label: 'Owner Messaging Center' }]} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent('printswift:open-workspace-enquiries')
                  );
                }
                router.push('/');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              <Building2 className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Open Full Owner Workspace</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerUnmountOverlaysToMap();
                router.push('/');
              }}
              data-testid="messages-back-to-map-btn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Return to Map</span>
            </button>
          </div>
        </div>

        {/* Header & Filter Controls */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-extrabold text-[var(--ps-text)]">
                  Owner Messaging &amp; Enquiries Center
                </h1>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Respond to visitor enquiries across your Churachandpur listings and track resolution status.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl bg-[var(--ps-bg)] p-1 border border-[var(--ps-border)] text-xs">
              {(
                [
                  { id: 'all', label: `All (${combinedEnquiries.length})` },
                  { id: 'open', label: 'Open' },
                  { id: 'in_progress', label: 'In Progress' },
                  { id: 'resolved', label: 'Resolved' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1.5 font-semibold transition ${
                    statusFilter === tab.id
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages by sender name, phone/email, or listing title..."
              className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] py-2.5 pl-10 pr-4 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>
        </section>

        {/* Enquiries List */}
        {filteredEnquiries.length === 0 ? (
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center text-xs text-[var(--ps-text-muted)]">
            No enquiries match your current filter.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEnquiries.map((enq) => (
              <article
                key={enq.id}
                data-testid={`message-thread-${enq.id}`}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[var(--ps-text)]">
                        {enq.senderName}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          enq.status === 'resolved'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : enq.status === 'in_progress'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                        }`}
                      >
                        {enq.status.replace('_', ' ')}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                        <Clock className="h-3 w-3" />
                        <span>{enq.createdAt}</span>
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Contact: <span className="font-mono">{enq.senderPhone || enq.senderEmail}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/listing/${encodeURIComponent(enq.listingId)}`}
                      className="inline-flex items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                    >
                      <span className="truncate max-w-[180px]">{enq.listingTitle}</span>
                      <ExternalLink className="h-3 w-3 text-[var(--ps-accent)] shrink-0" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          window.dispatchEvent(
                            new CustomEvent('printswift:focus-map-listing', {
                              detail: { listingId: enq.listingId },
                            })
                          );
                        }
                        router.push('/');
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      <MapPin className="h-3 w-3 text-[var(--ps-accent)]" />
                      <span>Map</span>
                    </button>
                  </div>
                </div>

                <p className="rounded-xl bg-[var(--ps-bg)] p-3.5 text-xs text-[var(--ps-text)] leading-relaxed border border-[var(--ps-border)]">
                  {enq.message}
                </p>

                {enq.ownerReply && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs space-y-1">
                    <div className="font-bold text-emerald-800 dark:text-emerald-200">
                      Owner Response
                    </div>
                    <p className="text-[var(--ps-text)]">{enq.ownerReply}</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={replyDrafts[enq.id] ?? ''}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({
                        ...prev,
                        [enq.id]: e.target.value,
                      }))
                    }
                    placeholder="Write an owner response or follow-up note..."
                    className="flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleSendReply(enq, 'in_progress')}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Send Reply</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSendReply(enq, 'resolved')}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Mark Resolved</span>
                    </button>
                  </div>
                </div>

                {replySavedId === enq.id && (
                  <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    Enquiry updated successfully.
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
