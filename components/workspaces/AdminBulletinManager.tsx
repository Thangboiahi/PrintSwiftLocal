'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  Flag,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Ticket,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { UserAccount } from '@/lib/types';

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  max_active_bulletins: number;
  max_monthly_posts: number;
  max_images_per_post: number;
  duration_days: number;
}

interface ProfileCandidate {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface ActiveSubscriptionItem {
  id: string;
  user_id: string;
  status: string;
  expires_at: string;
  payment_ref: string | null;
  created_at: string;
  userName: string;
  userEmail: string;
  planName: string;
  priceInr: number;
}

interface OpenReportItem {
  id: string;
  bulletin_id: string;
  reason: string;
  status: string;
  created_at: string;
  bulletinTitle: string;
  bulletinCategory: string;
  bulletinStatus: string;
  authorName: string;
  reporterName: string;
}

interface BulletinPostPassItem {
  id: string;
  user_id: string;
  price_inr: number;
  duration_days: number;
  upi_utr_ref: string | null;
  status: 'pending_verification' | 'available' | 'used' | 'rejected';
  created_at: string;
  userName: string;
  userEmail: string;
}

export interface AdminBulletinManagerProps {
  fallbackUsers?: UserAccount[];
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

export function AdminBulletinManager({
  fallbackUsers = [],
  onNotice,
}: AdminBulletinManagerProps) {
  const { user: authUser, role: syncedAuthRole } = useAuth();
  const { setStatus, clearStatus } = useAppStatus();

  const [isLoading, setIsLoading] = useState(true);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileCandidate[]>([]);
  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionItem[]>([]);
  const [postPasses, setPostPasses] = useState<BulletinPostPassItem[]>([]);
  const [openReports, setOpenReports] = useState<OpenReportItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Manual Activation Form State
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [isActivating, setIsActivating] = useState(false);

  // Report & Pass Action State
  const [processingReportId, setProcessingReportId] = useState<string | null>(
    null
  );
  const [processingPassId, setProcessingPassId] = useState<string | null>(null);

  const normalizedRole = (syncedAuthRole || '').toLowerCase();
  const isAuthorizedAdmin =
    !authUser ||
    normalizedRole === 'admin' ||
    normalizedRole === 'super_admin';

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setStatus('fetching_listings', 'Loading bulletin admin');

    try {
      if (!isSupabaseConfigured()) {
        setProfiles(
          fallbackUsers.map((u) => ({
            id: u.id,
            full_name: u.name,
            email: u.email,
            role: u.adminRole || u.roleType,
          }))
        );
        return;
      }

      const [plansRes, profilesRes, subsRes, passesRes, reportsRes] =
        await Promise.all([
          supabase
            .from('subscription_plans')
            .select(
              'id, slug, name, price_inr, max_active_bulletins, max_monthly_posts, max_images_per_post, duration_days'
            )
            .eq('is_active', true)
            .order('price_inr', { ascending: true }),
          supabase
            .from('profiles')
            .select('id, full_name, name, email, role')
            .order('created_at', { ascending: false })
            .limit(120),
          supabase
            .from('user_subscriptions')
            .select(
              'id, user_id, status, expires_at, payment_ref, created_at, profiles:user_id(full_name, name, email), subscription_plans:plan_id(name, price_inr)'
            )
            .order('created_at', { ascending: false })
            .limit(30),
          supabase
            .from('bulletin_post_passes')
            .select(
              'id, user_id, price_inr, duration_days, upi_utr_ref, status, created_at, profiles:user_id(full_name, name, email)'
            )
            .order('created_at', { ascending: false })
            .limit(40),
          supabase
            .from('bulletin_reports')
            .select(
              'id, bulletin_id, reason, status, created_at, reporter:reporter_id(full_name, name, email), bulletins:bulletin_id(id, title, category, status, author:author_id(full_name, name, email))'
            )
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .limit(40),
        ]);

      if (!plansRes.error && Array.isArray(plansRes.data)) {
        const fetchedPlans = plansRes.data as PlanRow[];
        setPlans(fetchedPlans);
        if (fetchedPlans.length > 0 && !selectedPlanId) {
          setSelectedPlanId(fetchedPlans[0].id);
        }
      }

      if (!profilesRes.error && Array.isArray(profilesRes.data)) {
        const mappedProfiles: ProfileCandidate[] = profilesRes.data.map(
          (row: Record<string, unknown>) => ({
            id: String(row.id || ''),
            full_name: String(row.full_name || row.name || 'Unnamed User'),
            email: String(row.email || ''),
            role: String(row.role || 'visitor'),
          })
        );
        setProfiles(mappedProfiles);
      }

      if (!subsRes.error && Array.isArray(subsRes.data)) {
        const mappedSubs: ActiveSubscriptionItem[] = subsRes.data.map(
          (row: Record<string, unknown>) => {
            const pObj = Array.isArray(row.profiles)
              ? (row.profiles[0] as Record<string, unknown> | undefined)
              : (row.profiles as Record<string, unknown> | undefined);
            const planObj = Array.isArray(row.subscription_plans)
              ? (row.subscription_plans[0] as Record<string, unknown> | undefined)
              : (row.subscription_plans as Record<string, unknown> | undefined);

            return {
              id: String(row.id || ''),
              user_id: String(row.user_id || ''),
              status: String(row.status || 'active'),
              expires_at: String(row.expires_at || ''),
              payment_ref: row.payment_ref ? String(row.payment_ref) : null,
              created_at: String(row.created_at || ''),
              userName: String(pObj?.full_name || pObj?.name || 'Subscriber'),
              userEmail: String(pObj?.email || ''),
              planName: String(planObj?.name || 'Plan'),
              priceInr: Number(planObj?.price_inr || 0),
            };
          }
        );
        setSubscriptions(mappedSubs);
      }

      if (!passesRes.error && Array.isArray(passesRes.data)) {
        const mappedPasses: BulletinPostPassItem[] = passesRes.data.map(
          (row: Record<string, unknown>) => {
            const pObj = Array.isArray(row.profiles)
              ? (row.profiles[0] as Record<string, unknown> | undefined)
              : (row.profiles as Record<string, unknown> | undefined);
            return {
              id: String(row.id || ''),
              user_id: String(row.user_id || ''),
              price_inr: Number(row.price_inr || 79),
              duration_days: Number(row.duration_days || 7),
              upi_utr_ref: row.upi_utr_ref ? String(row.upi_utr_ref) : null,
              status: (String(row.status || 'pending_verification') as BulletinPostPassItem['status']),
              created_at: String(row.created_at || ''),
              userName: String(pObj?.full_name || pObj?.name || 'Member'),
              userEmail: String(pObj?.email || ''),
            };
          }
        );
        // Surface pending_verification passes first
        mappedPasses.sort((a, b) => {
          const aPending = a.status === 'pending_verification' ? 0 : 1;
          const bPending = b.status === 'pending_verification' ? 0 : 1;
          if (aPending !== bPending) return aPending - bPending;
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        });
        setPostPasses(mappedPasses);
      }

      if (!reportsRes.error && Array.isArray(reportsRes.data)) {
        const mappedReports: OpenReportItem[] = reportsRes.data.map(
          (row: Record<string, unknown>) => {
            const bObj = Array.isArray(row.bulletins)
              ? (row.bulletins[0] as Record<string, unknown> | undefined)
              : (row.bulletins as Record<string, unknown> | undefined);
            const authorRaw = bObj?.author;
            const authorObj = Array.isArray(authorRaw)
              ? (authorRaw[0] as Record<string, unknown> | undefined)
              : (authorRaw as Record<string, unknown> | undefined);
            const repObj = Array.isArray(row.reporter)
              ? (row.reporter[0] as Record<string, unknown> | undefined)
              : (row.reporter as Record<string, unknown> | undefined);

            return {
              id: String(row.id || ''),
              bulletin_id: String(row.bulletin_id || ''),
              reason: String(row.reason || ''),
              status: String(row.status || 'open'),
              created_at: String(row.created_at || ''),
              bulletinTitle: String(bObj?.title || 'Deleted / Unknown Bulletin'),
              bulletinCategory: String(bObj?.category || 'notice'),
              bulletinStatus: String(bObj?.status || 'published'),
              authorName: String(
                authorObj?.full_name ||
                  authorObj?.name ||
                  authorObj?.email ||
                  'Unknown Author'
              ),
              reporterName: String(
                repObj?.full_name || repObj?.name || repObj?.email || 'Member'
              ),
            };
          }
        );
        setOpenReports(mappedReports);
      }

      if (plansRes.error && /subscription_plans/i.test(plansRes.error.message || '')) {
        setLoadError(
          'Phase 59 bulletin tables have not been pushed to Supabase yet. Run migration 20261119_phase59_bulletin.sql to enable live persistence.'
        );
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load bulletin admin data.'
      );
    } finally {
      setIsLoading(false);
      clearStatus();
    }
  }, [fallbackUsers, selectedPlanId, setStatus, clearStatus]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return profiles.slice(0, 8);
    return profiles
      .filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [profiles, userSearch]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedUserId) || null,
    [profiles, selectedUserId]
  );

  const planSelectOptions = useMemo<CustomSelectOption[]>(() => {
    return plans.map((plan) => ({
      value: plan.id,
      label: `${plan.name} — ₹${plan.price_inr}/${plan.duration_days}d`,
      description: `${plan.max_active_bulletins} active · ${plan.max_monthly_posts}/mo · ${plan.max_images_per_post} imgs`,
    }));
  }, [plans]);

  const handleActivatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !selectedPlanId || isActivating) return;

    const chosenPlan = plans.find((p) => p.id === selectedPlanId);
    if (!chosenPlan) return;

    setIsActivating(true);
    setStatus('saving', 'Activating plan');

    try {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured.');
      }

      const startsAt = new Date();
      const expiresAt = new Date(
        startsAt.getTime() + (chosenPlan.duration_days || 30) * 86400000
      );

      const { error } = await supabase.from('user_subscriptions').insert({
        user_id: selectedUserId,
        plan_id: chosenPlan.id,
        status: 'active',
        starts_at: startsAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        payment_ref: paymentRef.trim() || 'MANUAL-ADMIN-ACTIVATION',
        verified_by: authUser?.id || null,
      });

      if (error) {
        throw new Error(error.message || 'Failed to activate subscription.');
      }

      setStatus('success', 'Plan activated');
      onNotice?.({
        type: 'success',
        text: `Activated ${chosenPlan.name} plan for ${selectedProfile?.full_name || 'user'} (Ref: ${paymentRef.trim() || 'MANUAL-ADMIN-ACTIVATION'}).`,
      });
      setPaymentRef('');
      setSelectedUserId('');
      setUserSearch('');
      await loadData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Subscription activation failed.';
      setStatus('error', 'Activation failed');
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsActivating(false);
    }
  };

  const handleDismissReport = async (report: OpenReportItem) => {
    if (processingReportId) return;
    setProcessingReportId(report.id);
    setStatus('saving', 'Dismissing report');

    try {
      const { error } = await supabase
        .from('bulletin_reports')
        .update({ status: 'dismissed' })
        .eq('id', report.id);

      if (error) {
        throw new Error(error.message || 'Could not dismiss report.');
      }

      setOpenReports((prev) => prev.filter((r) => r.id !== report.id));
      setStatus('success', 'Report dismissed');
      onNotice?.({
        type: 'info',
        text: `Dismissed report for "${report.bulletinTitle}".`,
      });
    } catch (err) {
      setStatus('error', 'Action failed');
      onNotice?.({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to dismiss report.',
      });
    } finally {
      setProcessingReportId(null);
    }
  };

  const handleRemoveBulletin = async (report: OpenReportItem) => {
    if (processingReportId) return;
    setProcessingReportId(report.id);
    setStatus('saving', 'Removing bulletin');

    try {
      const { error: bulletinErr } = await supabase
        .from('bulletins')
        .update({ status: 'removed_by_admin' })
        .eq('id', report.bulletin_id);

      if (bulletinErr) {
        throw new Error(bulletinErr.message || 'Could not remove bulletin.');
      }

      const { error: reportErr } = await supabase
        .from('bulletin_reports')
        .update({ status: 'reviewed' })
        .eq('bulletin_id', report.bulletin_id)
        .eq('status', 'open');

      if (reportErr) {
        throw new Error(reportErr.message || 'Bulletin removed, but failed to mark report reviewed.');
      }

      setOpenReports((prev) =>
        prev.filter((r) => r.bulletin_id !== report.bulletin_id)
      );
      setStatus('success', 'Bulletin removed');
      onNotice?.({
        type: 'success',
        text: `Removed bulletin "${report.bulletinTitle}" and closed its open reports.`,
      });
    } catch (err) {
      setStatus('error', 'Removal failed');
      onNotice?.({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to remove bulletin.',
      });
    } finally {
      setProcessingReportId(null);
    }
  };

  const handleReviewPostPass = async (
    pass: BulletinPostPassItem,
    decision: 'available' | 'rejected'
  ) => {
    if (processingPassId) return;
    setProcessingPassId(pass.id);
    setStatus(
      'saving',
      decision === 'available' ? 'Approving post pass' : 'Rejecting post pass'
    );

    try {
      const { error } = await supabase
        .from('bulletin_post_passes')
        .update({
          status: decision,
          verified_by: authUser?.id || null,
        })
        .eq('id', pass.id);

      if (error) {
        throw new Error(error.message || 'Failed to update post pass status.');
      }

      setPostPasses((prev) =>
        prev.map((row) =>
          row.id === pass.id ? { ...row, status: decision } : row
        )
      );
      setStatus(
        'success',
        decision === 'available' ? 'Pass approved' : 'Pass rejected'
      );
      onNotice?.({
        type: decision === 'available' ? 'success' : 'info',
        text:
          decision === 'available'
            ? `Approved ₹${pass.price_inr} Single Post Pass for ${pass.userName} (UTR: ${pass.upi_utr_ref || 'N/A'}).`
            : `Rejected Single Post Pass request for ${pass.userName}.`,
      });
    } catch (err) {
      setStatus('error', 'Review failed');
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not update single post pass.',
      });
    } finally {
      setProcessingPassId(null);
    }
  };

  const pendingPassCount = useMemo(
    () => postPasses.filter((p) => p.status === 'pending_verification').length,
    [postPasses]
  );

  if (!isAuthorizedAdmin) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-2">
        <ShieldAlert className="w-6 h-6 text-rose-500 mx-auto" />
        <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
          Admin or Super Admin privileges required to manage Bulletin plans and moderation.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="admin-bulletin-manager"
      className="space-y-6"
    >
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-[var(--ps-text)]">
            Community Bulletins, Manual Subscriptions &amp; Moderation
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Activate verified UPI bulletin subscriptions and review open community moderation reports.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={isLoading}
          className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* SINGLE POST PASSES VERIFICATION QUEUE */}
      <section
        data-testid="admin-single-post-passes-section"
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              Single Post Passes — Pay-Per-Post UPI Verification ({postPasses.length})
            </h3>
          </div>
          {pendingPassCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300 tabular-nums">
              <Clock className="w-3 h-3" />
              <span>{pendingPassCount} Pending Verification</span>
            </span>
          )}
        </div>

        {isLoading && postPasses.length === 0 ? (
          <div className="py-6 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading Single Post Passes...</span>
          </div>
        ) : postPasses.length === 0 ? (
          <p className="text-xs text-[var(--ps-text-muted)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-4 text-center">
            No Pay-Per-Post UPI submissions yet. When users submit a ₹79 UTR from the Bulletin composer, it appears here for one-click approval.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-0.5">
            {postPasses.map((pass) => {
              const isBusy = processingPassId === pass.id;
              const isPending = pass.status === 'pending_verification';
              return (
                <div
                  key={pass.id}
                  data-testid={`admin-post-pass-${pass.id}`}
                  className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 text-xs ${
                    isPending
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[var(--ps-text)] truncate">
                        {pass.userName}{' '}
                        <span className="font-normal text-[var(--ps-text-muted)] tabular-nums">
                          · ₹{pass.price_inr} ({pass.duration_days}d)
                        </span>
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {pass.userEmail || pass.user_id.slice(0, 8)}
                      </p>
                      <p className="mt-1 font-mono text-[11px] font-semibold text-[var(--ps-text)]">
                        UTR: {pass.upi_utr_ref || '—'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase shrink-0 ${
                        pass.status === 'pending_verification'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : pass.status === 'available'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : pass.status === 'used'
                              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {pass.status === 'pending_verification'
                        ? 'Pending'
                        : pass.status}
                    </span>
                  </div>

                  {isPending && (
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--ps-border)]/60">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleReviewPostPass(pass, 'rejected')}
                        data-testid={`reject-post-pass-${pass.id}`}
                        className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-rose-500/10 text-xs font-semibold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleReviewPostPass(pass, 'available')}
                        data-testid={`approve-post-pass-${pass.id}`}
                        className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        <span>Approve Pass</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* PANEL 1: MANUAL PLAN ACTIVATION */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500 shrink-0" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              Manual Plan Activation (UPI / Offline Payment)
            </h3>
          </div>

          <form onSubmit={(e) => void handleActivatePlan(e)} className="space-y-3.5">
            {/* User Search & Selection */}
            <div className="space-y-2">
              <label
                htmlFor="admin-bulletin-user-search"
                className="block text-xs font-semibold text-[var(--ps-text)]"
              >
                1. Find &amp; Select User (by Email or Name)
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-bulletin-user-search"
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search registered profiles..."
                  data-testid="admin-plan-user-search"
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
              </div>

              {selectedProfile && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                    <UserCheck className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {selectedProfile.full_name} ({selectedProfile.email || selectedProfile.id.slice(0, 8)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedUserId('')}
                    className="text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] shrink-0"
                  >
                    Change
                  </button>
                </div>
              )}

              {!selectedProfile && (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] divide-y divide-[var(--ps-border)]/60">
                  {filteredProfiles.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-[var(--ps-text-muted)] text-center">
                      No matching users found.
                    </div>
                  ) : (
                    filteredProfiles.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedUserId(p.id)}
                        className="w-full px-3 py-2 text-left hover:bg-[var(--ps-surface-alt)] flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--ps-text)] truncate">
                            {p.full_name}
                          </div>
                          <div className="text-[11px] text-[var(--ps-text-muted)] truncate">
                            {p.email || p.id}
                          </div>
                        </div>
                        <span className="px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[10px] font-semibold uppercase text-[var(--ps-text-muted)] shrink-0">
                          {p.role}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Plan Selector via CustomSelectModal */}
            <CustomSelectModal
              label="2. Select Subscription Plan"
              id="admin-plan-select"
              testId="admin-plan-select"
              options={planSelectOptions}
              value={selectedPlanId}
              onChange={setSelectedPlanId}
              placeholder="Choose subscription plan"
              disabled={planSelectOptions.length === 0}
            />

            {/* Manual UPI Payment Reference */}
            <div>
              <label
                htmlFor="admin-upi-ref-input"
                className="block text-xs font-semibold text-[var(--ps-text)] mb-1"
              >
                3. Manual UPI / Payment Reference *
              </label>
              <div className="relative">
                <CreditCard className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-upi-ref-input"
                  type="text"
                  required
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g., UPI/432198765432 or CASH-LAMKA-01"
                  data-testid="admin-plan-payment-ref"
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={
                isActivating ||
                !selectedUserId ||
                !selectedPlanId ||
                !paymentRef.trim()
              }
              data-testid="admin-activate-plan-btn"
              className="w-full h-9 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity disabled:opacity-50"
            >
              {isActivating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Activating Plan...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Activate Subscription</span>
                </>
              )}
            </button>
          </form>

          {/* Recent Subscriptions List */}
          <div className="pt-3 border-t border-[var(--ps-border)] space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Recent Subscriptions ({subscriptions.length})
            </h4>
            {subscriptions.length === 0 ? (
              <p className="text-xs text-[var(--ps-text-muted)]">
                No active subscriptions recorded yet.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                {subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--ps-text)] truncate">
                        {sub.userName}{' '}
                        <span className="font-normal text-[var(--ps-text-muted)]">
                          · {sub.planName} (₹{sub.priceInr})
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        Ref: {sub.payment_ref || '—'} · Exp:{' '}
                        {new Date(sub.expires_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase shrink-0 ${
                        sub.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {sub.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* PANEL 2: MODERATION & OPEN REPORTS QUEUE */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-rose-500 shrink-0" />
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Open Bulletin Reports ({openReports.length})
              </h3>
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading open reports...</span>
            </div>
          ) : openReports.length === 0 ? (
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-8 text-center space-y-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
              <p className="text-xs font-bold text-[var(--ps-text)]">
                All clear — no open bulletin reports
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                User-submitted reports from the Community Bulletin will appear here for one-click review.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-0.5">
              {openReports.map((report) => {
                const isBusy = processingReportId === report.id;
                return (
                  <div
                    key={report.id}
                    data-testid={`admin-bulletin-report-${report.id}`}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[10px] font-bold uppercase">
                            {report.bulletinCategory}
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            by <strong className="text-[var(--ps-text)]">{report.authorName}</strong>
                          </span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-[var(--ps-text)] leading-snug">
                          {report.bulletinTitle}
                        </h4>
                      </div>
                      <span className="text-[10px] text-[var(--ps-text-muted)] whitespace-nowrap shrink-0">
                        {new Date(report.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </div>

                    <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 px-2.5 py-2 text-xs text-[var(--ps-text)]">
                      <span className="font-semibold text-rose-700 dark:text-rose-300">
                        Reported by {report.reporterName}:{' '}
                      </span>
                      <span>{report.reason}</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDismissReport(report)}
                        data-testid={`dismiss-report-btn-${report.id}`}
                        className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                        <span>Dismiss Report</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRemoveBulletin(report)}
                        data-testid={`remove-bulletin-btn-${report.id}`}
                        className="h-8 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Remove Bulletin</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default AdminBulletinManager;
