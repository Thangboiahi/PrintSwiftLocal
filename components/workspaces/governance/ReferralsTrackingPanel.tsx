'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Coins,
  Flag,
  Gift,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trophy,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { useAuth } from '@/lib/auth';
import type {
  OnboardingAndReferralsConfig,
  ServiceHubRecord,
} from '@/lib/config/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

type ReferralStatus =
  | 'pending'
  | 'qualified'
  | 'rewarded'
  | 'flagged'
  | 'rejected';

type ReferralType =
  | 'user_signup'
  | 'partner_onboarding'
  | 'driver_onboarding'
  | 'advertiser_onboarding';

interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_user_id: string;
  referral_code_used: string;
  hub_id: string | null;
  referral_type: ReferralType;
  status: ReferralStatus;
  reward_credit_inr: number;
  reward_note: string | null;
  reviewed_by: string | null;
  qualified_at: string | null;
  rewarded_at: string | null;
  created_at: string;
}

interface ProfileMini {
  id: string;
  full_name: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ReferralsTrackingPanelProps {
  /** When set, scopes referrals to this hub. Omit for global Super-Admin tracking. */
  hubId?: string | null;
  hubs?: ServiceHubRecord[];
  /** Enables the Onboarding Fees & Referral Settings editor (Super-Admin only). */
  isSuperAdmin?: boolean;
  onSavePlatformSetting?: (
    key: string,
    value: unknown,
    successMessage: string
  ) => Promise<boolean>;
  onPendingCountChange?: (count: number) => void;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const STATUS_FILTERS: Array<{ id: 'all' | ReferralStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'rewarded', label: 'Rewarded' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'rejected', label: 'Rejected' },
];

const TYPE_LABELS: Record<ReferralType, string> = {
  user_signup: 'User Sign-Up',
  partner_onboarding: 'Business Partner',
  driver_onboarding: 'Driver Fleet',
  advertiser_onboarding: 'Advertiser',
};

function getReferralStatusPill(status: ReferralStatus): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'rewarded':
      return {
        label: 'Rewarded',
        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      };
    case 'qualified':
      return {
        label: 'Qualified',
        cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
      };
    case 'flagged':
      return {
        label: 'Flagged',
        cls: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
      };
    default:
      return {
        label: 'Pending',
        cls: 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border-[var(--ps-accent)]/30',
      };
  }
}

export function ReferralsTrackingPanel({
  hubId = null,
  hubs = [],
  isSuperAdmin = false,
  onSavePlatformSetting,
  onPendingCountChange,
  onNotice,
}: ReferralsTrackingPanelProps) {
  const { user } = useAuth();
  const { onboardingAndReferrals, refreshConfig } = useAppConfig();
  const { setStatus } = useAppStatus();
  const { confirm: confirmDialog, dialog: confirmModal } = useConfirmDialog();

  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>(
    {}
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReferralStatus>(
    'all'
  );
  const [hubFilter, setHubFilter] = useState<string>('all');
  const [isMutatingId, setIsMutatingId] = useState<string | null>(null);

  // Reward credit modal state
  const [rewardTarget, setRewardTarget] = useState<ReferralRow | null>(null);
  const [rewardCreditInput, setRewardCreditInput] = useState<string>('100');
  const [rewardNoteInput, setRewardNoteInput] = useState<string>('');

  // Super-Admin settings draft state
  const [settingsDraft, setSettingsDraft] =
    useState<OnboardingAndReferralsConfig>(onboardingAndReferrals);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setSettingsDraft(onboardingAndReferrals);
    });
  }, [onboardingAndReferrals]);

  const hubMap = useMemo(() => {
    const map = new Map<string, ServiceHubRecord>();
    for (const h of hubs) map.set(h.id, h);
    return map;
  }, [hubs]);

  const hubFilterOptions: CustomSelectOption[] = useMemo(() => {
    const opts: CustomSelectOption[] = [
      { value: 'all', label: 'All Service Hubs' },
    ];
    for (const h of hubs) {
      opts.push({ value: h.id, label: h.name, description: h.state });
    }
    return opts;
  }, [hubs]);

  const fetchReferrals = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      let query = supabase
        .from('referrals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      if (hubId) {
        query = query.eq('hub_id', hubId);
      }

      const { data, error } = await query;
      if (error) {
        setLoadError(error.message);
        return;
      }

      const rows: ReferralRow[] = ((data ?? []) as Record<string, unknown>[]).map(
        (r) => ({
          id: String(r.id),
          referrer_id: String(r.referrer_id || ''),
          referred_user_id: String(r.referred_user_id || ''),
          referral_code_used: String(r.referral_code_used || ''),
          hub_id: r.hub_id ? String(r.hub_id) : null,
          referral_type: (r.referral_type || 'user_signup') as ReferralType,
          status: (r.status || 'pending') as ReferralStatus,
          reward_credit_inr: Number(r.reward_credit_inr ?? 0),
          reward_note: r.reward_note ? String(r.reward_note) : null,
          reviewed_by: r.reviewed_by ? String(r.reviewed_by) : null,
          qualified_at: r.qualified_at ? String(r.qualified_at) : null,
          rewarded_at: r.rewarded_at ? String(r.rewarded_at) : null,
          created_at: String(r.created_at || new Date().toISOString()),
        })
      );

      setReferrals(rows);
      onPendingCountChange?.(
        rows.filter((r) => r.status === 'pending' || r.status === 'qualified')
          .length
      );

      // Hydrate referrer & referred user labels
      const uniqueIds = Array.from(
        new Set(
          rows
            .flatMap((r) => [r.referrer_id, r.referred_user_id])
            .filter(Boolean)
        )
      );
      if (uniqueIds.length > 0) {
        const { data: profData } = await supabase
          .from('profiles')
          .select('id, full_name, name, email, phone')
          .in('id', uniqueIds.slice(0, 200));

        const nextMap: Record<string, ProfileMini> = {};
        for (const p of (profData ?? []) as ProfileMini[]) {
          nextMap[p.id] = p;
        }
        setProfilesById(nextMap);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load referrals.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [hubId, onPendingCountChange]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchReferrals();
    });
  }, [fetchReferrals]);

  const getProfileLabel = useCallback(
    (id: string): { title: string; sub: string } => {
      const p = profilesById[id];
      if (!p) return { title: id.slice(0, 8), sub: 'User' };
      return {
        title: p.full_name || p.name || p.email || id.slice(0, 8),
        sub: p.phone || p.email || '',
      };
    },
    [profilesById]
  );

  const kpis = useMemo(() => {
    let pending = 0;
    let qualified = 0;
    let rewarded = 0;
    let totalCredit = 0;
    const byReferrer = new Map<
      string,
      { referrerId: string; total: number; qualifiedOrRewarded: number }
    >();

    for (const r of referrals) {
      if (r.status === 'pending') pending += 1;
      else if (r.status === 'qualified') qualified += 1;
      else if (r.status === 'rewarded') {
        rewarded += 1;
        totalCredit += Number(r.reward_credit_inr || 0);
      }

      const prev = byReferrer.get(r.referrer_id) || {
        referrerId: r.referrer_id,
        total: 0,
        qualifiedOrRewarded: 0,
      };
      prev.total += 1;
      if (r.status === 'qualified' || r.status === 'rewarded') {
        prev.qualifiedOrRewarded += 1;
      }
      byReferrer.set(r.referrer_id, prev);
    }

    const topReferrers = Array.from(byReferrer.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      total: referrals.length,
      pending,
      qualified,
      rewarded,
      totalCredit,
      topReferrers,
    };
  }, [referrals]);

  const filteredReferrals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return referrals.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!hubId && hubFilter !== 'all' && row.hub_id !== hubFilter)
        return false;
      if (!q) return true;
      const refA = getProfileLabel(row.referrer_id);
      const refB = getProfileLabel(row.referred_user_id);
      const hubName = row.hub_id ? hubMap.get(row.hub_id)?.name || '' : '';
      const haystack = [
        row.referral_code_used,
        refA.title,
        refA.sub,
        refB.title,
        refB.sub,
        hubName,
        TYPE_LABELS[row.referral_type],
        row.reward_note || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    referrals,
    search,
    statusFilter,
    hubId,
    hubFilter,
    getProfileLabel,
    hubMap,
  ]);

  const handleUpdateReferralStatus = async (
    row: ReferralRow,
    nextStatus: ReferralStatus,
    creditOverride?: number,
    noteOverride?: string
  ) => {
    setIsMutatingId(row.id);
    setStatus('saving', 'Updating referral status…');
    try {
      const nowIso = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        reviewed_by: user?.id ?? null,
        updated_at: nowIso,
      };
      if (nextStatus === 'qualified') {
        updatePayload.qualified_at = row.qualified_at || nowIso;
      }
      if (nextStatus === 'rewarded') {
        updatePayload.qualified_at = row.qualified_at || nowIso;
        updatePayload.rewarded_at = nowIso;
        updatePayload.reward_credit_inr = Math.max(
          0,
          Math.round(Number(creditOverride ?? row.reward_credit_inr ?? 0))
        );
        updatePayload.reward_note = noteOverride?.trim() || row.reward_note;
      }
      if (
        (nextStatus === 'flagged' || nextStatus === 'rejected') &&
        noteOverride?.trim()
      ) {
        updatePayload.reward_note = noteOverride.trim();
      }

      const { error } = await supabase
        .from('referrals')
        .update(updatePayload)
        .eq('id', row.id);

      if (error) {
        setStatus('error', error.message);
        onNotice?.({ type: 'error', text: error.message });
        return;
      }

      const msg = `Referral ${row.referral_code_used} marked as ${getReferralStatusPill(nextStatus).label}.`;
      setStatus('success', msg);
      onNotice?.({ type: 'success', text: msg });
      await fetchReferrals();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not update referral.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsMutatingId(null);
    }
  };

  const handleQuickQualify = async (row: ReferralRow) => {
    const ok = await confirmDialog({
      title: 'Mark Referral Qualified?',
      description: `Confirm that the invited user completed signup/onboarding via code ${row.referral_code_used}.`,
      confirmLabel: 'Mark Qualified',
    });
    if (!ok) return;
    await handleUpdateReferralStatus(row, 'qualified');
  };

  const handleQuickFlagReject = async (
    row: ReferralRow,
    mode: 'flagged' | 'rejected'
  ) => {
    const ok = await confirmDialog({
      title:
        mode === 'flagged'
          ? 'Flag Referral for Audit?'
          : 'Reject Referral Entry?',
      description:
        mode === 'flagged'
          ? `Flag referral ${row.referral_code_used} as suspicious or duplicate pending review.`
          : `Reject referral ${row.referral_code_used}. No reward credit will be issued.`,
      confirmLabel: mode === 'flagged' ? 'Flag Referral' : 'Reject Referral',
      variant: mode === 'rejected' ? 'danger' : 'default',
    });
    if (!ok) return;
    await handleUpdateReferralStatus(row, mode);
  };

  const handleOpenRewardModal = (row: ReferralRow) => {
    setRewardTarget(row);
    setRewardCreditInput(
      String(
        row.reward_credit_inr > 0
          ? row.reward_credit_inr
          : onboardingAndReferrals.default_referral_credit_inr || 100
      )
    );
    setRewardNoteInput(row.reward_note || 'Verified referral reward credit');
  };

  const handleConfirmReward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rewardTarget) return;
    const creditNum = Math.max(0, Math.round(Number(rewardCreditInput) || 0));
    await handleUpdateReferralStatus(
      rewardTarget,
      'rewarded',
      creditNum,
      rewardNoteInput
    );
    setRewardTarget(null);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSettings) return;
    setIsSavingSettings(true);
    try {
      const cleanPayload: OnboardingAndReferralsConfig = {
        driver_registration_fee_inr: Math.max(
          0,
          Math.round(Number(settingsDraft.driver_registration_fee_inr) || 0)
        ),
        business_registration_fee_inr: Math.max(
          0,
          Math.round(Number(settingsDraft.business_registration_fee_inr) || 0)
        ),
        advertiser_registration_fee_inr: Math.max(
          0,
          Math.round(Number(settingsDraft.advertiser_registration_fee_inr) || 0)
        ),
        registration_fee_note: settingsDraft.registration_fee_note.trim(),
        referrals_enabled: Boolean(settingsDraft.referrals_enabled),
        referral_reward_summary: settingsDraft.referral_reward_summary.trim(),
        default_referral_credit_inr: Math.max(
          0,
          Math.round(Number(settingsDraft.default_referral_credit_inr) || 0)
        ),
        support_whatsapp: settingsDraft.support_whatsapp?.trim() || '',
      };

      if (onSavePlatformSetting) {
        await onSavePlatformSetting(
          'onboarding_and_referrals',
          cleanPayload,
          'Onboarding fees & referral policy saved and applied live!'
        );
      } else {
        const { error } = await supabase.from('platform_settings').upsert(
          {
            key: 'onboarding_and_referrals',
            value: cleanPayload,
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
        if (error) {
          setStatus('error', error.message);
          onNotice?.({ type: 'error', text: error.message });
          return;
        }
        await refreshConfig(true);
        const msg = 'Onboarding fees & referral policy saved!';
        setStatus('success', msg);
        onNotice?.({ type: 'success', text: msg });
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div
      data-testid="referrals-tracking-panel"
      className="space-y-4 min-w-0 max-w-full overflow-x-clip text-[var(--ps-text)]"
    >
      {/* KPI Header + Top Referrers */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
              <h3 className="text-sm font-extrabold tracking-tight text-[var(--ps-text)] truncate">
                Referrals &amp; Invite Tracking Desk
              </h3>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
              Verify referred sign-ups, partner/driver invites, reward credits, and top community ambassadors.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchReferrals()}
            disabled={isLoading}
            className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 hover:bg-[var(--ps-surface-alt)] disabled:opacity-60 cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: 'Total Invites', value: String(kpis.total), tone: 'text-[var(--ps-text)]' },
            { label: 'Pending', value: String(kpis.pending), tone: 'text-[var(--ps-accent)]' },
            { label: 'Qualified', value: String(kpis.qualified), tone: 'text-sky-600 dark:text-sky-400' },
            { label: 'Rewarded', value: String(kpis.rewarded), tone: 'text-emerald-600 dark:text-emerald-400' },
            {
              label: 'Credits Issued',
              value: `₹${kpis.totalCredit.toLocaleString('en-IN')}`,
              tone: 'text-amber-700 dark:text-amber-300',
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 min-w-0"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] truncate">
                {stat.label}
              </p>
              <p
                className={`mt-0.5 text-lg font-extrabold tabular-nums truncate ${stat.tone}`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {kpis.topReferrers.length > 0 && (
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Top Referrers</span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {kpis.topReferrers.map((entry, idx) => {
                const info = getProfileLabel(entry.referrerId);
                return (
                  <div
                    key={entry.referrerId}
                    className="shrink-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 min-w-[165px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400">
                        #{idx + 1}
                      </span>
                      <span className="text-[10px] font-bold text-[var(--ps-text-muted)] tabular-nums">
                        {entry.qualifiedOrRewarded}/{entry.total} qual.
                      </span>
                    </div>
                    <p className="text-xs font-bold text-[var(--ps-text)] truncate mt-0.5">
                      {info.title}
                    </p>
                    {info.sub && (
                      <p className="text-[10px] text-[var(--ps-text-muted)] truncate">
                        {info.sub}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Super-Admin Only: Onboarding Fees & Referral Policy Editor */}
      {isSuperAdmin && (
        <form
          onSubmit={handleSaveSettings}
          data-testid="superadmin-onboarding-referral-settings"
          className="rounded-2xl border border-[var(--ps-accent)]/35 bg-[var(--ps-surface)] p-4 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Settings2 className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
              <div className="min-w-0">
                <h4 className="text-xs sm:text-sm font-extrabold text-[var(--ps-text)]">
                  Referral Program &amp; Onboarding Registration Fees
                </h4>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Disclosed transparently on /onboarding before users submit applications.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  referrals_enabled: !prev.referrals_enabled,
                }))
              }
              className={`h-8 px-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 ${
                settingsDraft.referrals_enabled
                  ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
              }`}
            >
              {settingsDraft.referrals_enabled ? (
                <ToggleRight className="w-4 h-4" />
              ) : (
                <ToggleLeft className="w-4 h-4" />
              )}
              <span>
                Referrals {settingsDraft.referrals_enabled ? 'Enabled' : 'Paused'}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[var(--ps-text)]">
                Business Reg. Fee (₹)
              </label>
              <input
                type="number"
                min={0}
                value={settingsDraft.business_registration_fee_inr}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    business_registration_fee_inr: Number(e.target.value) || 0,
                  }))
                }
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[var(--ps-text)]">
                Driver Reg. Fee (₹)
              </label>
              <input
                type="number"
                min={0}
                value={settingsDraft.driver_registration_fee_inr}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    driver_registration_fee_inr: Number(e.target.value) || 0,
                  }))
                }
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[var(--ps-text)]">
                Advertiser Reg. Fee (₹)
              </label>
              <input
                type="number"
                min={0}
                value={settingsDraft.advertiser_registration_fee_inr}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    advertiser_registration_fee_inr:
                      Number(e.target.value) || 0,
                  }))
                }
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[var(--ps-text)]">
                Default Referral Credit (₹)
              </label>
              <input
                type="number"
                min={0}
                value={settingsDraft.default_referral_credit_inr}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    default_referral_credit_inr: Number(e.target.value) || 0,
                  }))
                }
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[var(--ps-text)]">
                Registration Fee Disclosure Note
              </label>
              <input
                type="text"
                value={settingsDraft.registration_fee_note}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    registration_fee_note: e.target.value,
                  }))
                }
                placeholder="One-time onboarding & manual KYC verification charge payable only after approval."
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[var(--ps-text)]">
                Referral Reward Summary (Shown to Users)
              </label>
              <input
                type="text"
                value={settingsDraft.referral_reward_summary}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    referral_reward_summary: e.target.value,
                  }))
                }
                placeholder="Invite friends, local shops, or drivers to DD oodle and earn verified community rewards."
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-[var(--ps-text-muted)]">
              Changes apply immediately to `/onboarding`, `/profile`, and WhatsApp handoff notices.
            </span>
            <button
              type="submit"
              disabled={isSavingSettings}
              data-testid="save-onboarding-referral-settings-btn"
              className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60 cursor-pointer shrink-0"
            >
              {isSavingSettings ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save &amp; Apply</span>
            </button>
          </div>
        </form>
      )}

      {/* Search + Filters + Table */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3">
        <WorkspaceTableToolbar>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search referral code, referrer, invited user, or hub…"
              data-testid="referrals-search-input"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>

          {!hubId && hubs.length > 0 && (
            <div className="w-full sm:w-52 shrink-0">
              <CustomSelectModal
                value={hubFilter}
                onChange={setHubFilter}
                options={hubFilterOptions}
                placeholder="Filter by Hub"
              />
            </div>
          )}
        </WorkspaceTableToolbar>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 max-w-full">
          {STATUS_FILTERS.map((opt) => {
            const active = statusFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {loadError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">{loadError}</span>
          </div>
        )}

        <ResponsiveTableScroll minWidthClass="min-w-[820px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)] bg-[var(--ps-bg)]/70">
                <th className="py-2.5 px-3 font-bold">Code &amp; Date</th>
                <th className="py-2.5 px-3 font-bold">Referrer</th>
                <th className="py-2.5 px-3 font-bold">Invited User</th>
                <th className="py-2.5 px-3 font-bold">Type &amp; Hub</th>
                <th className="py-2.5 px-3 font-bold">Status &amp; Credit</th>
                <th className="py-2.5 px-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-10 text-center text-[var(--ps-text-muted)]"
                  >
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1.5" />
                    Loading referrals…
                  </td>
                </tr>
              ) : filteredReferrals.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-10 text-center text-[var(--ps-text-muted)]"
                  >
                    No referral records match the current filters.
                  </td>
                </tr>
              ) : (
                filteredReferrals.map((row) => {
                  const referrer = getProfileLabel(row.referrer_id);
                  const referred = getProfileLabel(row.referred_user_id);
                  const pill = getReferralStatusPill(row.status);
                  const hubName = row.hub_id
                    ? hubMap.get(row.hub_id)?.name || 'Hub'
                    : 'Global';
                  const isBusy = isMutatingId === row.id;

                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-[var(--ps-surface-alt)]/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="font-mono font-bold text-[var(--ps-accent)]">
                          {row.referral_code_used}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)] mt-0.5 tabular-nums">
                          {new Date(row.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[180px]">
                        <div className="font-bold text-[var(--ps-text)] truncate">
                          {referrer.title}
                        </div>
                        {referrer.sub && (
                          <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                            {referrer.sub}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[180px]">
                        <div className="font-semibold text-[var(--ps-text)] truncate">
                          {referred.title}
                        </div>
                        {referred.sub && (
                          <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                            {referred.sub}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="font-semibold text-[var(--ps-text)]">
                          {TYPE_LABELS[row.referral_type] || row.referral_type}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)]">
                          {hubName}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${pill.cls}`}
                          >
                            {pill.label}
                          </span>
                          {row.reward_credit_inr > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300">
                              <Coins className="w-3 h-3" />₹
                              {row.reward_credit_inr}
                            </span>
                          )}
                        </div>
                        {row.reward_note && (
                          <p className="text-[10px] text-[var(--ps-text-muted)] mt-0.5 max-w-[180px] truncate">
                            {row.reward_note}
                          </p>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {row.status === 'pending' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleQuickQualify(row)}
                              className="h-7 px-2 rounded-lg border border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300 text-[11px] font-bold inline-flex items-center gap-1 hover:bg-sky-500/20 disabled:opacity-50 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Qualify</span>
                            </button>
                          )}

                          {(row.status === 'pending' ||
                            row.status === 'qualified') && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleOpenRewardModal(row)}
                              className="h-7 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold inline-flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                            >
                              <Award className="w-3 h-3" />
                              <span>Reward</span>
                            </button>
                          )}

                          {row.status !== 'rejected' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickFlagReject(
                                  row,
                                  row.status === 'flagged'
                                    ? 'rejected'
                                    : 'flagged'
                                )
                              }
                              className="h-7 px-2 rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[11px] font-bold inline-flex items-center gap-1 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                            >
                              <Flag className="w-3 h-3" />
                              <span>
                                {row.status === 'flagged' ? 'Reject' : 'Flag'}
                              </span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </div>

      {/* Reward Credit Modal (z-[90]) */}
      {rewardTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Issue Referral Reward Credit"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setRewardTarget(null)}
        >
          <form
            onSubmit={handleConfirmReward}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <h4 className="text-sm font-extrabold">
                  Mark Referral Rewarded
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setRewardTarget(null)}
                className="h-7 w-7 rounded-lg border border-[var(--ps-border)] inline-flex items-center justify-center text-[var(--ps-text-muted)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-xs text-[var(--ps-text-muted)]">
              Issuing reward for code{' '}
              <strong className="font-mono text-[var(--ps-text)]">
                {rewardTarget.referral_code_used}
              </strong>{' '}
              (Referrer: {getProfileLabel(rewardTarget.referrer_id).title}).
            </p>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-[var(--ps-text)]">
                Reward Credit Amount (₹)
              </label>
              <input
                type="number"
                min={0}
                required
                value={rewardCreditInput}
                onChange={(e) => setRewardCreditInput(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-[var(--ps-text)]">
                Reward Note / Payout Reference
              </label>
              <input
                type="text"
                value={rewardNoteInput}
                onChange={(e) => setRewardNoteInput(e.target.value)}
                placeholder="e.g., Bulletin wallet credit / UPI payout ref"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRewardTarget(null)}
                className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMutatingId === rewardTarget.id}
                className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
              >
                {isMutatingId === rewardTarget.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Award className="w-3.5 h-3.5" />
                )}
                <span>Confirm Reward</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmModal}
    </div>
  );
}
