'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  Loader2,
  Share2,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { useShare } from '@/components/ui/ShareSheetModal';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import {
  clearPendingReferralCode,
  normalizeReferralCode,
  readPendingReferralCode,
} from '@/lib/referrals/pending-ref';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { buildContextualWhatsAppMessage } from '@/lib/utils/whatsapp';

interface ReferralLedgerRow {
  id: string;
  referral_type: string;
  status: string;
  reward_amount_inr: number;
  created_at: string;
  qualified_at: string | null;
  rewarded_at: string | null;
}

const REFERRAL_STATUS_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  pending: {
    label: 'Pending',
    badgeClass:
      'border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
  qualified: {
    label: 'Qualified',
    badgeClass:
      'border-sky-500/30 bg-sky-500/12 text-sky-700 dark:text-sky-300',
  },
  rewarded: {
    label: 'Rewarded',
    badgeClass:
      'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
  rejected: {
    label: 'Closed',
    badgeClass:
      'border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
  },
};

export function ReferralCard() {
  const { user } = useAuth();
  const { activeHub, onboardingAndReferrals } = useAppConfig();
  const { share } = useShare();
  const { setStatus } = useAppStatus();

  const [myCode, setMyCode] = useState<string>('');
  const [referredByUserId, setReferredByUserId] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<ReferralLedgerRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const [friendCodeInput, setFriendCodeInput] = useState<string>(() => {
    return readPendingReferralCode() || '';
  });
  const [isApplyingCode, setIsApplyingCode] = useState<boolean>(false);
  const [applyFeedback, setApplyFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const referralsEnabled =
    onboardingAndReferrals?.referrals_enabled !== false;
  const rewardInr = Number(
    onboardingAndReferrals?.default_referral_credit_inr ?? 50
  );

  const userId = user?.id ?? null;

  const loadReferralData = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [codeRpcRes, profileRes, ledgerRes] = await Promise.all([
        supabase.rpc('ensure_user_referral_code'),
        supabase
          .from('profiles')
          .select('referral_code, referred_by_user_id')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('referrals')
          .select(
            'id, referral_type, status, reward_credit_inr, created_at, qualified_at, rewarded_at'
          )
          .eq('referrer_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const resolvedCode =
        (typeof codeRpcRes.data === 'string' && codeRpcRes.data.trim()) ||
        (typeof profileRes.data?.referral_code === 'string' &&
          profileRes.data.referral_code.trim()) ||
        '';
      setMyCode(resolvedCode);
      setReferredByUserId(
        typeof profileRes.data?.referred_by_user_id === 'string'
          ? profileRes.data.referred_by_user_id
          : null
      );

      if (Array.isArray(ledgerRes.data)) {
        setReferrals(
          ledgerRes.data.map((row) => ({
            id: String(row.id),
            referral_type: String(row.referral_type || 'user_signup'),
            status: String(row.status || 'pending'),
            reward_amount_inr: Number(row.reward_credit_inr || 0),
            created_at: String(row.created_at || ''),
            qualified_at:
              typeof row.qualified_at === 'string' ? row.qualified_at : null,
            rewarded_at:
              typeof row.rewarded_at === 'string' ? row.rewarded_at : null,
          }))
        );
      }
    } catch {
      // Non-fatal fallback
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (!userId || !isSupabaseConfigured()) {
      queueMicrotask(() => {
        if (active) setIsLoading(false);
      });
      return () => {
        active = false;
      };
    }

    const timer = window.setTimeout(() => {
      if (active) {
        void loadReferralData();
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId, loadReferralData]);

  const isHydrated = useHydrated();
  const inviteUrl = useMemo(() => {
    if (!myCode) return '';
    const origin =
      isHydrated && typeof window !== 'undefined' ? window.location.origin : '';
    return origin
      ? `${origin}/?ref=${encodeURIComponent(myCode)}`
      : `/?ref=${encodeURIComponent(myCode)}`;
  }, [myCode, isHydrated]);

  const counts = useMemo(() => {
    let pending = 0;
    let qualified = 0;
    let rewarded = 0;
    for (const row of referrals) {
      if (row.status === 'pending') pending++;
      else if (row.status === 'qualified') qualified++;
      else if (row.status === 'rewarded') rewarded++;
    }
    return { pending, qualified, rewarded };
  }, [referrals]);

  const handleCopyCode = async () => {
    if (!myCode) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(myCode);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (ok) {
      setCopied(true);
      setStatus('success', 'Referral code copied');
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setStatus('error', 'Could not copy code');
    }
  };

  const handleShareInvite = () => {
    if (!myCode) return;
    const hubName = activeHub?.name || 'your city';
    const message = buildContextualWhatsAppMessage({
      type: 'referral_invite',
      hub: hubName,
      code: myCode,
      url: inviteUrl,
    });
    void share({
      title: 'Join DD oodle with my Referral Code',
      text: `Use my DD oodle invite code ${myCode} to discover ${hubName}, Pick N Drop, food & print.`,
      url: inviteUrl,
      whatsappMessage: message,
    });
  };

  const handleApplyFriendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyFeedback(null);
    const cleaned = normalizeReferralCode(friendCodeInput);
    if (!cleaned) {
      setApplyFeedback({
        type: 'error',
        text: 'Enter a valid referral code (e.g., DDOODLE123).',
      });
      return;
    }

    setIsApplyingCode(true);
    try {
      const { data, error } = await supabase.rpc('apply_referral_code', {
        p_code: cleaned,
        p_referral_type: 'user_signup',
        p_hub_id: activeHub?.id || null,
      });

      if (error) {
        setApplyFeedback({
          type: 'error',
          text: error.message || 'Could not apply referral code.',
        });
        return;
      }

      const result = data as { ok?: boolean; error?: string } | null;
      if (result && result.ok === false) {
        setApplyFeedback({
          type: 'error',
          text: result.error || 'Referral code could not be applied.',
        });
        return;
      }

      clearPendingReferralCode();
      setFriendCodeInput('');
      setApplyFeedback({
        type: 'success',
        text: `Referral code ${cleaned} applied! Welcome to DD oodle.`,
      });
      setStatus('success', 'Referral code applied');
      await loadReferralData();
    } catch (err) {
      setApplyFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Network error applying referral code.',
      });
    } finally {
      setIsApplyingCode(false);
    }
  };

  if (!user || !referralsEnabled) {
    return null;
  }

  return (
    <section
      id="referrals"
      data-testid="profile-referral-card"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 shadow-xs space-y-4 scroll-mt-24"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-theme-primary/25 bg-theme-primary/10 text-theme-primary">
            <Gift className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-[var(--ps-text)]">
              Invite Friends &amp; Earn
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Share your personal code for {activeHub?.name || 'your hub'}
              {rewardInr > 0
                ? ` — earn ₹${rewardInr.toLocaleString('en-IN')} credit per qualified invite.`
                : ' and grow your local community.'}
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-theme-primary/25 bg-theme-primary/10 px-2 py-0.5 text-[10px] font-bold text-theme-primary">
          <Sparkles className="h-3 w-3" />
          <span>Referrals</span>
        </span>
      </div>

      {/* Personal Code & Share Bar */}
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/80 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Your Personal Referral Code
          </div>
          {isLoading ? (
            <div className="mt-1 h-6 w-32 animate-pulse rounded bg-[var(--ps-surface-alt)]" />
          ) : (
            <div
              data-testid="my-referral-code-value"
              className="mt-0.5 font-mono text-lg font-extrabold tracking-widest text-[var(--ps-text)] select-all"
            >
              {myCode || 'UNAVAILABLE'}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!myCode || isLoading}
            onClick={() => void handleCopyCode()}
            data-testid="copy-referral-code-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-theme-primary hover:text-theme-primary transition-colors disabled:opacity-50 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-theme-primary" />
                <span>Copy Code</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!myCode || isLoading}
            onClick={handleShareInvite}
            data-testid="share-referral-invite-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>Share Invite</span>
          </button>
        </div>
      </div>

      {/* Enter a Friend's Referral Code (only shown if user has not already been referred) */}
      {!isLoading && !referredByUserId && (
        <form
          onSubmit={(e) => void handleApplyFriendCode(e)}
          data-testid="apply-friend-referral-form"
          className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/40 p-3 space-y-2"
        >
          <label
            htmlFor="friend-referral-code-input"
            className="block text-xs font-bold text-[var(--ps-text)]"
          >
            Enter a Friend&apos;s Referral Code
          </label>
          <div className="flex items-center gap-2">
            <input
              id="friend-referral-code-input"
              type="text"
              value={friendCodeInput}
              onChange={(e) =>
                setFriendCodeInput(e.target.value.toUpperCase().slice(0, 24))
              }
              placeholder="e.g. DDOODLE7A2B"
              data-testid="friend-referral-code-input"
              className="h-9 flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-mono text-xs font-bold uppercase tracking-wider text-[var(--ps-text)] placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--ps-text-muted)] focus:border-theme-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={isApplyingCode || !friendCodeInput.trim()}
              data-testid="apply-friend-referral-btn"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground transition-opacity hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {isApplyingCode ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              <span>Apply</span>
            </button>
          </div>

          {applyFeedback && (
            <p
              className={`text-[11px] font-semibold ${
                applyFeedback.type === 'success'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {applyFeedback.text}
            </p>
          )}
        </form>
      )}

      {!isLoading && referredByUserId && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>A referral code is linked to your account.</span>
        </div>
      )}

      {/* My Referrals Tracker */}
      <div className="space-y-2.5 pt-1 border-t border-[var(--ps-border)]">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <Users className="h-3.5 w-3.5 text-theme-primary" />
            <span>My Referrals Tracker</span>
          </h3>
          <span className="font-mono text-[11px] font-semibold text-[var(--ps-text-muted)]">
            {referrals.length} total
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/70 p-2.5 text-center">
            <div className="font-mono text-base font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">
              {counts.pending}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)]">
              Pending
            </div>
          </div>
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/70 p-2.5 text-center">
            <div className="font-mono text-base font-extrabold text-sky-600 dark:text-sky-400 tabular-nums">
              {counts.qualified}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)]">
              Qualified
            </div>
          </div>
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/70 p-2.5 text-center">
            <div className="font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {counts.rewarded}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)]">
              Rewarded
            </div>
          </div>
        </div>

        {referrals.length > 0 ? (
          <div className="divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/40 overflow-hidden">
            {referrals.slice(0, 6).map((item) => {
              const badge =
                REFERRAL_STATUS_META[item.status] ||
                REFERRAL_STATUS_META.pending;
              const typeLabel =
                item.referral_type === 'partner_application'
                  ? 'Partner Referral'
                  : 'Friend Signup';
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-[var(--ps-text)] block truncate">
                      {typeLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-muted)]">
                      <Clock className="h-2.5 w-2.5" />
                      {item.created_at
                        ? new Date(item.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'Asia/Kolkata',
                          })
                        : 'Recent'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.reward_amount_inr > 0 && (
                      <span className="font-mono text-[11px] font-bold text-[var(--ps-text)] tabular-nums">
                        ₹{item.reward_amount_inr.toLocaleString('en-IN')}
                      </span>
                    )}
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.badgeClass}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--ps-border)] px-3 py-2.5 text-center text-[11px] text-[var(--ps-text-muted)]">
            No invites tracked yet. Tap <strong>Share Invite</strong> above to send your personal link!
          </p>
        )}
      </div>
    </section>
  );
}

export default ReferralCard;
