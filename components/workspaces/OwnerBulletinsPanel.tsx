'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Crown,
  Loader2,
  Megaphone,
  Pin,
  Plus,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import { BulletinComposerModal } from '@/components/bulletin/BulletinComposerModal';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { Listing } from '@/lib/types';

interface OwnerBulletinItem {
  id: string;
  title: string;
  excerpt: string | null;
  category: string;
  status: string;
  is_pinned: boolean;
  created_at: string;
  expires_at: string | null;
}

interface ActiveSubPlan {
  planName: string;
  expiresAt: string | null;
  maxActive: number;
  maxMonthly: number;
}

export interface OwnerBulletinsPanelProps {
  mode: 'owner' | 'staff';
  listings: Listing[];
}

export function OwnerBulletinsPanel({
  mode,
  listings,
}: OwnerBulletinsPanelProps) {
  const { user: authUser } = useAuth();
  const [bulletins, setBulletins] = useState<OwnerBulletinItem[]>([]);
  const [subPlan, setSubPlan] = useState<ActiveSubPlan | null>(null);
  const [availablePassesCount, setAvailablePassesCount] = useState(0);
  const [pendingPassesCount, setPendingPassesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const listingIdsKey = useMemo(
    () => listings.map((l) => l.id).join(','),
    [listings]
  );

  const authUserId = authUser?.id || '';

  const loadBulletins = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id || authUserId;
      if (!uid) {
        setIsLoading(false);
        return;
      }

      if (mode === 'owner') {
        const [bulRes, subRes, passesRes] = await Promise.all([
          supabase
            .from('bulletins')
            .select(
              'id, title, excerpt, category, status, is_pinned, created_at, expires_at'
            )
            .eq('author_id', uid)
            .order('created_at', { ascending: false })
            .limit(40),
          supabase
            .from('user_subscriptions')
            .select(
              'expires_at, status, subscription_plans(name, max_active_bulletins, max_monthly_posts)'
            )
            .eq('user_id', uid)
            .eq('status', 'active')
            .gte('expires_at', new Date().toISOString())
            .order('expires_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('bulletin_post_passes')
            .select('id, status')
            .eq('user_id', uid)
            .in('status', ['available', 'pending_verification']),
        ]);

        setBulletins((bulRes.data || []) as OwnerBulletinItem[]);

        const passRows = (passesRes.data || []) as Array<{
          id: string;
          status: string;
        }>;
        setAvailablePassesCount(
          passRows.filter((p) => p.status === 'available').length
        );
        setPendingPassesCount(
          passRows.filter((p) => p.status === 'pending_verification').length
        );

        if (subRes.data) {
          const rec = subRes.data as {
            expires_at?: string | null;
            subscription_plans?:
              | {
                  name?: string;
                  max_active_bulletins?: number;
                  max_monthly_posts?: number;
                }
              | Array<{
                  name?: string;
                  max_active_bulletins?: number;
                  max_monthly_posts?: number;
                }>;
          };
          const plan = Array.isArray(rec.subscription_plans)
            ? rec.subscription_plans[0]
            : rec.subscription_plans;
          if (plan) {
            setSubPlan({
              planName: plan.name || 'Active Plan',
              expiresAt: rec.expires_at || null,
              maxActive: Number(plan.max_active_bulletins || 2),
              maxMonthly: Number(plan.max_monthly_posts || 5),
            });
          } else {
            setSubPlan(null);
          }
        } else {
          setSubPlan(null);
        }
      } else {
        // Staff read-only view: bulletins linked to delegated listings
        const ids = listingIdsKey
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (ids.length === 0) {
          setBulletins([]);
          setIsLoading(false);
          return;
        }
        const { data } = await supabase
          .from('bulletins')
          .select(
            'id, title, excerpt, category, status, is_pinned, created_at, expires_at'
          )
          .in('listing_id', ids)
          .order('created_at', { ascending: false })
          .limit(30);
        setBulletins((data || []) as OwnerBulletinItem[]);
      }
    } catch {
      // keep existing UI state gracefully
    } finally {
      setIsLoading(false);
    }
  }, [authUserId, listingIdsKey, mode]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadBulletins();
    });
  }, [loadBulletins]);

  const activeCount = useMemo(
    () => bulletins.filter((b) => b.status === 'active').length,
    [bulletins]
  );

  const monthlyCount = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return bulletins.filter(
      (b) => new Date(b.created_at).getTime() >= startOfMonth.getTime()
    ).length;
  }, [bulletins]);

  const handleArchive = async (bulletin: OwnerBulletinItem) => {
    setArchivingId(bulletin.id);
    setAppStatus('saving', 'Archiving bulletin…');
    try {
      const { error } = await supabase
        .from('bulletins')
        .update({ status: 'archived' })
        .eq('id', bulletin.id);
      if (error) throw new Error(error.message);

      setBulletins((prev) =>
        prev.map((b) =>
          b.id === bulletin.id ? { ...b, status: 'archived' } : b
        )
      );
      setFeedback(`Archived "${bulletin.title}".`);
      setAppStatus('success', 'Bulletin archived');
    } catch {
      setAppStatus('error', 'Archive failed');
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Quota Strip */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              {mode === 'owner'
                ? 'Bulletins & Subscription Quota'
                : 'Shop Bulletins (Read-Only)'}
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              {mode === 'owner'
                ? 'Track your active subscription slots and publish rich-text announcements to /bulletin.'
                : 'Published announcements linked to your delegated shop listings.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadBulletins()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              aria-label="Refresh bulletins"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {mode === 'owner' && (
              <button
                type="button"
                onClick={() => setIsComposerOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Post Bulletin</span>
              </button>
            )}
          </div>
        </div>

        {mode === 'owner' && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--ps-border)] pt-3 sm:grid-cols-4">
            <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)]">
                Active Plan
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-[var(--ps-text)]">
                <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="truncate">
                  {subPlan ? subPlan.planName : 'No Monthly Plan'}
                </span>
              </p>
            </div>
            <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)]">
                Single Post Passes
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                <Ticket className="h-3.5 w-3.5 shrink-0" />
                <span>{availablePassesCount} available</span>
              </p>
              {pendingPassesCount > 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                  +{pendingPassesCount} pending review
                </p>
              )}
            </div>
            <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)]">
                Active Slots Remaining
              </p>
              <p className="mt-0.5 text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                {subPlan
                  ? `${Math.max(0, subPlan.maxActive - activeCount)} / ${subPlan.maxActive}`
                  : `${activeCount} active`}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)]">
                Monthly Quota Remaining
              </p>
              <p className="mt-0.5 text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                {subPlan
                  ? `${Math.max(0, subPlan.maxMonthly - monthlyCount)} / ${subPlan.maxMonthly}`
                  : `${monthlyCount} this month`}
              </p>
            </div>
          </div>
        )}
      </div>

      {feedback && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>{feedback}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-10 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading bulletins…
        </div>
      ) : bulletins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <Megaphone className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
            No bulletins published yet
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            {mode === 'owner'
              ? 'Click "Post Bulletin" to publish announcements or review subscription plans.'
              : 'No community bulletins are currently linked to your assigned listings.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {bulletins.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.is_pinned && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-[var(--ps-accent)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]">
                      <Pin className="h-2.5 w-2.5" />
                      Pinned
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      item.status === 'active'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {item.status}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                    {item.category}
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold text-[var(--ps-text)] sm:text-sm">
                  {item.title}
                </p>
                {item.excerpt && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--ps-text-muted)]">
                    {item.excerpt}
                  </p>
                )}
              </div>

              {mode === 'owner' && item.status === 'active' && (
                <button
                  type="button"
                  disabled={archivingId === item.id}
                  onClick={() => void handleArchive(item)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400"
                >
                  {archivingId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                  <span>Archive</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {mode === 'owner' && (
        <BulletinComposerModal
          open={isComposerOpen}
          onClose={() => setIsComposerOpen(false)}
          onPublished={() => {
            setIsComposerOpen(false);
            setFeedback('Bulletin published live!');
            void loadBulletins();
          }}
        />
      )}
    </div>
  );
}

export default OwnerBulletinsPanel;
