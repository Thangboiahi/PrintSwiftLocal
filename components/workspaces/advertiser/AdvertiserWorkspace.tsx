'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Crown,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  LayoutDashboard,
  MapPin,
  Megaphone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Video,
} from 'lucide-react';
import {
  BulletinComposerModal,
  type EditableBulletinRecord,
} from '@/components/bulletin/BulletinComposerModal';
import { isValidYouTubeVideoId } from '@/components/bulletin/BulletinContentRenderer';
import { PayPerCheckoutModal } from '@/components/monetization/PayPerCheckoutModal';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { GetFeaturedModal } from '@/components/home/GetFeaturedModal';
import { useHub } from '@/components/providers/AppConfigProvider';
import {
  WorkspaceNavShell,
  type WorkspaceNavGroup,
} from '@/components/workspaces/shared/WorkspaceNavShell';
import {
  DEFAULT_PAY_PER_CONFIGS,
  fetchPayPerPricingConfig,
  type PayPerPricingConfig,
} from '@/lib/monetization/pay-per';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

type AdvertiserSectionId =
  | 'overview'
  | 'bulletins'
  | 'plans_orders'
  | 'featured_requests';

type StatusFilter =
  | 'all'
  | 'published'
  | 'pending'
  | 'expiring'
  | 'archived';

type TypeFilter =
  | 'all'
  | 'announcement'
  | 'job'
  | 'event'
  | 'video'
  | 'ad'
  | 'notice';

interface PlanCandidate {
  id: string;
  slug: string;
  title: string;
  info: string;
  price_inr: number;
  duration_days: number;
  trial_days: number;
  target_scope: string;
  max_monthly_posts: number;
  max_active_bulletins: number;
  allow_youtube: boolean;
  auto_verify_bulletins: boolean;
}

interface ExpiringBulletinAlert {
  id: string;
  title: string;
  category: string;
  status: string;
  paid_until: string;
  expires_at: string | null;
  is_expired: boolean;
  days_left: number;
}

interface PayPerOrderRow {
  id: string;
  target_id: string;
  target_title: string;
  module_key: string;
  duration_days: number;
  amount_inr: number;
  payment_method: string;
  upi_utr_ref: string | null;
  status: string;
  paid_until: string | null;
  review_notes: string | null;
  created_at: string;
}

interface AdvertiserSummaryData {
  profile: {
    id: string;
    full_name: string;
    trial_used_at: string | null;
    is_trial_eligible: boolean;
  };
  active_subscription: {
    subscription_id: string | null;
    plan_id: string | null;
    plan_slug: string;
    plan_name: string;
    plan_info: string;
    status: string;
    is_trial: boolean;
    is_default_free: boolean;
    starts_at: string | null;
    ends_at: string | null;
    days_remaining: number | null;
  };
  auto_verify_bulletins: boolean;
  quota_usage: {
    monthly_used: number;
    monthly_limit: number | null;
    active_used: number;
    active_limit: number | null;
    allow_youtube: boolean;
    max_images_per_post: number;
  };
  bulletin_counts: {
    total: number;
    published: number;
    pending: number;
    archived: number;
    expiring_soon: number;
    expired: number;
  };
  targeted_vip_plans: PlanCandidate[];
  trial_eligible_plans: PlanCandidate[];
  expiring_bulletins: ExpiringBulletinAlert[];
  recent_pay_per_orders: PayPerOrderRow[];
}

interface AdvertiserBulletinRow extends EditableBulletinRecord {
  id: string;
  title: string;
  category: string;
  status: string;
  is_verified?: boolean;
  is_pinned?: boolean;
  views_count?: number;
  created_at: string;
  expires_at: string | null;
  paid_until: string | null;
  youtube_video_id?: string | null;
}

// v21a (P0-11): canonical `public.featured_requests` columns (pass_v9a)
interface FeaturedRequestRow {
  id: string;
  request_code: string;
  slot_section: string;
  entity_type: string;
  entity_id: string;
  duration_days: number;
  quoted_fee_inr: number;
  preferred_contact: string;
  contact_phone: string;
  notes: string | null;
  status: string;
  reviewer_notes: string | null;
  created_at: string;
}

const FEATURED_SLOT_LABELS: Record<string, string> = {
  featured_places: 'Featured Places',
  featured_products: 'Featured Products',
  featured_properties: 'Featured Properties',
  featured_vehicles: 'Featured Vehicles',
};

const WITHDRAWABLE_FEATURED_STATUSES = new Set(['submitted', 'under_review']);

const CATEGORY_LABELS: Record<string, string> = {
  announcement: 'Announcement',
  job: 'Job Post',
  event: 'Event',
  ad: 'Advertisement',
  notice: 'Notice',
};

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getPaidWindowMeta(paidUntil: string | null | undefined) {
  if (!paidUntil) {
    return { state: 'none' as const, daysLeft: null };
  }
  const ms = new Date(paidUntil).getTime();
  if (!Number.isFinite(ms)) return { state: 'none' as const, daysLeft: null };
  const diffDays = Math.ceil((ms - Date.now()) / 86400000);
  if (ms <= Date.now()) {
    return { state: 'expired' as const, daysLeft: diffDays };
  }
  if (diffDays <= 7) {
    return { state: 'expiring_soon' as const, daysLeft: diffDays };
  }
  return { state: 'active' as const, daysLeft: diffDays };
}

export interface AdvertiserWorkspaceProps {
  contextSwitcherSlot?: React.ReactNode;
}

export function AdvertiserWorkspace({
  contextSwitcherSlot,
}: AdvertiserWorkspaceProps) {
  const { user, fullName } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();

  const [activeSection, setActiveSection] =
    useState<AdvertiserSectionId>('overview');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [summary, setSummary] = useState<AdvertiserSummaryData | null>(null);
  const [bulletins, setBulletins] = useState<AdvertiserBulletinRow[]>([]);
  const [publicPlans, setPublicPlans] = useState<PlanCandidate[]>([]);
  const [payPerConfig, setPayPerConfig] = useState<PayPerPricingConfig>(
    DEFAULT_PAY_PER_CONFIGS.bulletin_post
  );
  const [featuredRequests, setFeaturedRequests] = useState<
    FeaturedRequestRow[]
  >([]);

  // Bulletins filters & UI state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // Composer & Pay-Per / Plan modals
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<'compose' | 'plans'>(
    'compose'
  );
  const [editingBulletin, setEditingBulletin] =
    useState<EditableBulletinRecord | null>(null);
  const [renewTarget, setRenewTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentRecord | null>(
    null
  );
  const [paymentUpiDetails, setPaymentUpiDetails] = useState<{
    upiId?: string;
    upiPayeeName?: string;
  }>({});

  // Featured request modal (canonical GetFeaturedModal → public.featured_requests)
  const [featuredModalOpen, setFeaturedModalOpen] = useState(false);
  const { activeHub } = useHub();

  // Action states
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [startingTrialPlanId, setStartingTrialPlanId] = useState<string | null>(
    null
  );
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(
    null
  );
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const loadWorkspaceData = useCallback(
    async (silent = false) => {
      if (!user || !isSupabaseConfigured()) {
        setIsLoading(false);
        return;
      }

      if (silent) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const [
          summaryRes,
          bulletinsRes,
          plansRes,
          payPerCfgRes,
          featuredRes,
        ] = await Promise.allSettled([
          supabase.rpc('get_advertiser_workspace_summary'),
          supabase
            .from('bulletins')
            .select(
              'id, title, category, content_json, content_plain, image_urls, youtube_video_id, contact_channels, linked_listing_id, status, is_verified, is_pinned, views_count, created_at, expires_at, paid_until'
            )
            .eq('author_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('subscription_plans')
            .select(
              'id, slug, name, title, tagline, info, price_inr, duration_days, trial_days, target_scope, is_default_free, is_archived, max_monthly_posts, max_active_bulletins, allow_youtube, entitlements, sort_order'
            )
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          fetchPayPerPricingConfig('bulletin_post'),
          supabase
            .from('featured_requests')
            .select(
              'id, request_code, slot_section, entity_type, entity_id, duration_days, quoted_fee_inr, preferred_contact, contact_phone, notes, status, reviewer_notes, created_at'
            )
            .eq('requester_id', user.id)
            .order('created_at', { ascending: false })
            .limit(25),
        ]);

        const fetchedBulletins =
          bulletinsRes.status === 'fulfilled' &&
          Array.isArray(bulletinsRes.value.data)
            ? (bulletinsRes.value.data as AdvertiserBulletinRow[])
            : [];
        setBulletins(fetchedBulletins);

        if (payPerCfgRes.status === 'fulfilled' && payPerCfgRes.value) {
          setPayPerConfig(payPerCfgRes.value);
        }

        if (
          featuredRes.status === 'fulfilled' &&
          Array.isArray(featuredRes.value.data)
        ) {
          setFeaturedRequests(featuredRes.value.data as FeaturedRequestRow[]);
        }

        const mappedPlans: PlanCandidate[] =
          plansRes.status === 'fulfilled' && Array.isArray(plansRes.value.data)
            ? (plansRes.value.data as Array<Record<string, unknown>>)
                .filter((p) => !p.is_archived && !p.is_default_free)
                .map((p) => {
                  const ent = (p.entitlements || {}) as Record<string, unknown>;
                  return {
                    id: String(p.id),
                    slug: String(p.slug || ''),
                    title: String(p.title || p.name || 'Advertiser Plan'),
                    info: String(p.info || p.tagline || ''),
                    price_inr: Number(p.price_inr ?? 0),
                    duration_days: Number(p.duration_days ?? 30),
                    trial_days: Number(p.trial_days ?? 0),
                    target_scope: String(p.target_scope || 'public'),
                    max_monthly_posts: Number(p.max_monthly_posts ?? 0),
                    max_active_bulletins: Number(p.max_active_bulletins ?? 0),
                    allow_youtube: Boolean(p.allow_youtube),
                    auto_verify_bulletins: Boolean(ent.auto_verify_bulletins),
                  };
                })
            : [];
        setPublicPlans(mappedPlans);

        if (
          summaryRes.status === 'fulfilled' &&
          !summaryRes.value.error &&
          summaryRes.value.data &&
          typeof summaryRes.value.data === 'object'
        ) {
          const raw = summaryRes.value.data as Record<string, unknown>;
          const prof = (raw.profile || {}) as Record<string, unknown>;
          const sub = (raw.active_subscription || {}) as Record<
            string,
            unknown
          >;
          const quota = (raw.quota_usage || {}) as Record<string, unknown>;
          const counts = (raw.bulletin_counts || {}) as Record<string, unknown>;

          setSummary({
            profile: {
              id: String(prof.id || user.id),
              full_name: String(
                prof.full_name || fullName || 'Advertiser'
              ),
              trial_used_at:
                typeof prof.trial_used_at === 'string'
                  ? prof.trial_used_at
                  : null,
              is_trial_eligible: Boolean(prof.is_trial_eligible),
            },
            active_subscription: {
              subscription_id:
                typeof sub.subscription_id === 'string'
                  ? sub.subscription_id
                  : null,
              plan_id: typeof sub.plan_id === 'string' ? sub.plan_id : null,
              plan_slug: String(sub.plan_slug || 'default-free-tier'),
              plan_name: String(sub.plan_name || 'Default Free Tier'),
              plan_info: String(
                sub.plan_info || 'Baseline community advertiser tier.'
              ),
              status: String(sub.status || 'default_free'),
              is_trial: Boolean(sub.is_trial),
              is_default_free: Boolean(sub.is_default_free ?? true),
              starts_at:
                typeof sub.starts_at === 'string' ? sub.starts_at : null,
              ends_at: typeof sub.ends_at === 'string' ? sub.ends_at : null,
              days_remaining:
                typeof sub.days_remaining === 'number'
                  ? sub.days_remaining
                  : null,
            },
            auto_verify_bulletins: Boolean(raw.auto_verify_bulletins),
            quota_usage: {
              monthly_used: Number(quota.monthly_used ?? 0),
              monthly_limit:
                typeof quota.monthly_limit === 'number'
                  ? quota.monthly_limit
                  : null,
              active_used: Number(quota.active_used ?? 0),
              active_limit:
                typeof quota.active_limit === 'number'
                  ? quota.active_limit
                  : null,
              allow_youtube: Boolean(quota.allow_youtube),
              max_images_per_post: Number(quota.max_images_per_post ?? 3),
            },
            bulletin_counts: {
              total: Number(counts.total ?? fetchedBulletins.length),
              published: Number(counts.published ?? 0),
              pending: Number(counts.pending ?? 0),
              archived: Number(counts.archived ?? 0),
              expiring_soon: Number(counts.expiring_soon ?? 0),
              expired: Number(counts.expired ?? 0),
            },
            targeted_vip_plans: Array.isArray(raw.targeted_vip_plans)
              ? (raw.targeted_vip_plans as PlanCandidate[])
              : [],
            trial_eligible_plans: Array.isArray(raw.trial_eligible_plans)
              ? (raw.trial_eligible_plans as PlanCandidate[])
              : [],
            expiring_bulletins: Array.isArray(raw.expiring_bulletins)
              ? (raw.expiring_bulletins as ExpiringBulletinAlert[])
              : [],
            recent_pay_per_orders: Array.isArray(raw.recent_pay_per_orders)
              ? (raw.recent_pay_per_orders as PayPerOrderRow[])
              : [],
          });
        } else {
          // Graceful direct-query fallback if v20a RPC has not been applied yet
          const [profRes, ordersRes] = await Promise.allSettled([
            supabase
              .from('profiles')
              .select('trial_used_at')
              .eq('id', user.id)
              .maybeSingle(),
            supabase
              .from('pay_per_orders')
              .select('*')
              .eq('user_id', user.id)
              .eq('module_key', 'bulletin_post')
              .order('created_at', { ascending: false })
              .limit(20),
          ]);

          const now = Date.now();
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);

          let pub = 0;
          let pend = 0;
          let arch = 0;
          let expSoon = 0;
          let expPast = 0;
          let mUsed = 0;
          const expAlerts: ExpiringBulletinAlert[] = [];

          for (const b of fetchedBulletins) {
            if (new Date(b.created_at) >= startOfMonth) mUsed += 1;
            const win = getPaidWindowMeta(b.paid_until);
            if (win.state === 'expired') {
              expPast += 1;
              expAlerts.push({
                id: b.id,
                title: b.title,
                category: b.category,
                status: b.status,
                paid_until: b.paid_until!,
                expires_at: b.expires_at,
                is_expired: true,
                days_left: win.daysLeft ?? 0,
              });
            } else if (win.state === 'expiring_soon') {
              expSoon += 1;
              expAlerts.push({
                id: b.id,
                title: b.title,
                category: b.category,
                status: b.status,
                paid_until: b.paid_until!,
                expires_at: b.expires_at,
                is_expired: false,
                days_left: win.daysLeft ?? 0,
              });
            }

            if (b.status === 'published' && win.state !== 'expired') pub += 1;
            else if (
              ['pending', 'pending_review', 'pending_payment', 'draft'].includes(
                b.status
              )
            )
              pend += 1;
            else if (['archived', 'unpublished', 'rejected'].includes(b.status))
              arch += 1;
          }

          const rawOrders =
            ordersRes.status === 'fulfilled' &&
            Array.isArray(ordersRes.value.data)
              ? (ordersRes.value.data as Array<Record<string, unknown>>)
              : [];

          const titleById = new Map(fetchedBulletins.map((b) => [b.id, b.title]));
          const mappedOrders: PayPerOrderRow[] = rawOrders.map((o) => ({
            id: String(o.id),
            target_id: String(o.target_id),
            target_title:
              titleById.get(String(o.target_id)) || 'Bulletin Notice',
            module_key: String(o.module_key || 'bulletin_post'),
            duration_days: Number(o.duration_days ?? 7),
            amount_inr: Number(o.amount_inr ?? 0),
            payment_method: String(o.payment_method || 'upi'),
            upi_utr_ref:
              typeof o.upi_utr_ref === 'string' ? o.upi_utr_ref : null,
            status: String(o.status || 'pending_verification'),
            paid_until:
              typeof o.paid_until === 'string' ? o.paid_until : null,
            review_notes:
              typeof o.review_notes === 'string' ? o.review_notes : null,
            created_at: String(o.created_at || new Date().toISOString()),
          }));

          const trialUsedAt =
            profRes.status === 'fulfilled' &&
            typeof profRes.value.data?.trial_used_at === 'string'
              ? profRes.value.data.trial_used_at
              : null;

          setSummary({
            profile: {
              id: user.id,
              full_name: fullName || 'Advertiser',
              trial_used_at: trialUsedAt,
              is_trial_eligible: !trialUsedAt,
            },
            active_subscription: {
              subscription_id: null,
              plan_id: null,
              plan_slug: 'default-free-tier',
              plan_name: 'Default Free Tier',
              plan_info:
                'Baseline starter tier. Start a free trial or publish via Pay-Per anytime.',
              status: 'default_free',
              is_trial: false,
              is_default_free: true,
              starts_at: null,
              ends_at: null,
              days_remaining: null,
            },
            auto_verify_bulletins: false,
            quota_usage: {
              monthly_used: mUsed,
              monthly_limit: 0,
              active_used: pub,
              active_limit: 0,
              allow_youtube: false,
              max_images_per_post: 3,
            },
            bulletin_counts: {
              total: fetchedBulletins.length,
              published: pub,
              pending: pend,
              archived: arch,
              expiring_soon: expSoon,
              expired: expPast,
            },
            targeted_vip_plans: mappedPlans.filter(
              (p) => p.target_scope === 'selected_users'
            ),
            trial_eligible_plans: mappedPlans.filter((p) => p.trial_days > 0),
            expiring_bulletins: expAlerts.sort(
              (a, b) =>
                new Date(a.paid_until).getTime() -
                new Date(b.paid_until).getTime()
            ),
            recent_pay_per_orders: mappedOrders,
          });
          void now;
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user, fullName]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadWorkspaceData(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadWorkspaceData]);

  // Actions: Free Trial, Subscribe, Bulletin Lifecycle Mutations
  const handleStartFreeTrial = async (plan: PlanCandidate) => {
    const accepted = await confirm({
      title: `Start ${plan.trial_days}-Day Free Trial on "${plan.title}"?`,
      description: `Unlock "${plan.title}" immediately for ${plan.trial_days} days at ₹0. Each account is eligible for one free trial.`,
      caution:
        'After the trial ends, your bulletins remain safe and your account reverts to the Default Free Tier unless renewed.',
      impactSummary: [
        `Plan: ${plan.title}`,
        `Monthly quota: ${plan.max_monthly_posts} bulletins / month`,
        `Trial duration: ${plan.trial_days} days (₹0 today)`,
      ],
      confirmLabel: `Start ${plan.trial_days}-Day Free Trial`,
      cancelLabel: 'Not Now',
      variant: 'info',
    });
    if (!accepted) return;

    setStartingTrialPlanId(plan.id);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('start_plan_trial', {
        p_plan_id: plan.id,
      });
      if (error) throw new Error(error.message);
      setNotice({
        type: 'success',
        text: `Activated ${plan.trial_days}-day free trial for "${plan.title}"! Your monthly bulletin quota is live.`,
      });
      await loadWorkspaceData(true);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to activate free trial right now.',
      });
    } finally {
      setStartingTrialPlanId(null);
    }
  };

  const handleSubscribePlan = async (plan: PlanCandidate) => {
    if (!user) return;
    const accepted = await confirm({
      title: `Subscribe to "${plan.title}" (₹${plan.price_inr.toLocaleString('en-IN')})?`,
      description: `Starts secure UPI checkout for ${plan.duration_days} days of "${plan.title}".`,
      impactSummary: [
        `Amount: ₹${plan.price_inr.toLocaleString('en-IN')}`,
        `Monthly quota: ${plan.max_monthly_posts} bulletins`,
      ],
      confirmLabel: 'Proceed to UPI Checkout',
      cancelLabel: 'Cancel',
      variant: 'info',
    });
    if (!accepted) return;

    setSubscribingPlanId(plan.id);
    setNotice(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in again to start subscription checkout.');
      }
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          purpose: 'bulletin_subscription',
          planId: plan.id,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        intent?: PaymentIntentRecord;
        upi_id?: string;
        upi_payee_name?: string;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        throw new Error(
          json.error || 'Unable to initialize subscription payment right now.'
        );
      }
      setPaymentUpiDetails({
        upiId: json.upi_id,
        upiPayeeName: json.upi_payee_name,
      });
      setPaymentIntent(json.intent);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to initialize subscription payment right now.',
      });
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const handleToggleArchiveBulletin = async (row: AdvertiserBulletinRow) => {
    if (!user) return;
    const isCurrentlyArchived = row.status === 'archived';
    const nextStatus = isCurrentlyArchived ? 'published' : 'archived';

    const accepted = await confirm({
      title: isCurrentlyArchived
        ? `Republish "${row.title}"?`
        : `Archive & Unpublish "${row.title}"?`,
      description: isCurrentlyArchived
        ? 'This notice will be restored to public visibility on /bulletin (subject to valid expiry/paid window).'
        : 'This notice will be hidden from the public /bulletin feed immediately. Your data stays safe and can be restored anytime.',
      caution: 'This lifecycle change is recorded in the Advertiser audit trail.',
      confirmLabel: isCurrentlyArchived ? 'Republish Notice' : 'Archive Notice',
      cancelLabel: 'Cancel',
      variant: isCurrentlyArchived ? 'info' : 'warning',
    });
    if (!accepted) return;

    setMutatingId(row.id);
    setNotice(null);
    try {
      const { error } = await supabase
        .from('bulletins')
        .update({ status: nextStatus })
        .eq('id', row.id)
        .eq('author_id', user.id);
      if (error) throw new Error(error.message);
      setNotice({
        type: 'success',
        text: isCurrentlyArchived
          ? `"${row.title}" has been republished.`
          : `"${row.title}" has been archived and unpublished from the public feed.`,
      });
      await loadWorkspaceData(true);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to update bulletin status.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const handleDeleteBulletin = async (row: AdvertiserBulletinRow) => {
    if (!user) return;
    const accepted = await confirm({
      title: `Permanently Delete "${row.title}"?`,
      description:
        'This permanently deletes the bulletin notice and removes it from your history.',
      caution:
        'Deleted notices cannot be recovered. Prefer Archive if you plan to renew or reuse this notice later.',
      confirmLabel: 'Delete Permanently',
      cancelLabel: 'Keep Notice',
      variant: 'danger',
    });
    if (!accepted) return;

    setMutatingId(row.id);
    setNotice(null);
    try {
      const { error } = await supabase
        .from('bulletins')
        .delete()
        .eq('id', row.id)
        .eq('author_id', user.id);
      if (error) throw new Error(error.message);
      setNotice({
        type: 'success',
        text: `"${row.title}" has been deleted.`,
      });
      await loadWorkspaceData(true);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to delete bulletin right now.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const openNewFeaturedModal = () => {
    setNotice(null);
    setFeaturedModalOpen(true);
  };

  const handleCancelFeaturedRequest = async (req: FeaturedRequestRow) => {
    if (!user) return;
    const accepted = await confirm({
      title: `Withdraw Featured Request ${req.request_code}?`,
      description:
        'Withdraws this pending homepage spotlight request from the review queue.',
      confirmLabel: 'Withdraw Request',
      cancelLabel: 'Keep Request',
      variant: 'warning',
    });
    if (!accepted) return;

    setMutatingId(req.id);
    setNotice(null);
    try {
      // v21a (P0-11): requesters cannot UPDATE featured_requests (RLS); withdraw via audited RPC
      const { error } = await supabase.rpc('withdraw_featured_request', {
        p_request_id: req.id,
        p_reason: null,
      });
      if (error) throw new Error(error.message);
      setNotice({
        type: 'success',
        text: `Featured request ${req.request_code} withdrawn.`,
      });
      await loadWorkspaceData(true);
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to cancel request right now.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  // Filtered Bulletins
  const filteredBulletins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bulletins.filter((b) => {
      const win = getPaidWindowMeta(b.paid_until);
      const isPending = [
        'pending',
        'pending_review',
        'pending_payment',
        'draft',
      ].includes(b.status);
      const isArchived = ['archived', 'unpublished', 'rejected'].includes(
        b.status
      );

      if (statusFilter === 'published') {
        if (b.status !== 'published' || win.state === 'expired') return false;
      } else if (statusFilter === 'pending') {
        if (!isPending) return false;
      } else if (statusFilter === 'expiring') {
        if (win.state !== 'expired' && win.state !== 'expiring_soon')
          return false;
      } else if (statusFilter === 'archived') {
        if (!isArchived) return false;
      }

      if (typeFilter === 'video') {
        if (!isValidYouTubeVideoId(b.youtube_video_id)) return false;
      } else if (typeFilter !== 'all') {
        if (b.category !== typeFilter) return false;
      }

      if (q) {
        const hay = `${b.title} ${b.category} ${b.content_plain || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bulletins, statusFilter, typeFilter, searchQuery]);

  const expiringAlertsCount =
    (summary?.bulletin_counts.expiring_soon ?? 0) +
    (summary?.bulletin_counts.expired ?? 0);

  const navGroups: WorkspaceNavGroup[] = useMemo(
    () => [
      {
        id: 'advertiser_desk',
        label: 'Advertiser Desk',
        shortLabel: 'Desk',
        icon: Megaphone,
        items: [
          {
            id: 'overview',
            label: 'Overview & Plan Quota',
            shortLabel: 'Overview',
            icon: LayoutDashboard,
            badge: expiringAlertsCount > 0 ? expiringAlertsCount : undefined,
          },
          {
            id: 'bulletins',
            label: 'My Bulletins & Notices',
            shortLabel: 'Bulletins',
            icon: FileText,
            badge: summary?.bulletin_counts.total || undefined,
          },
        ],
      },
      {
        id: 'billing_promos',
        label: 'Monetization & Promos',
        shortLabel: 'Plans',
        icon: Crown,
        items: [
          {
            id: 'plans_orders',
            label: 'Plans, Trials & Pay-Per Orders',
            shortLabel: 'Plans & Pay-Per',
            icon: Receipt,
            badge:
              summary?.recent_pay_per_orders.filter(
                (o) => o.status === 'pending_verification'
              ).length || undefined,
          },
          {
            id: 'featured_requests',
            label: 'Featured & Promo Requests',
            shortLabel: 'Featured',
            icon: Star,
            badge:
              featuredRequests.filter((f) => f.status === 'pending').length ||
              undefined,
          },
        ],
      },
    ],
    [
      expiringAlertsCount,
      summary?.bulletin_counts.total,
      summary?.recent_pay_per_orders,
      featuredRequests,
    ]
  );

  const activeSub = summary?.active_subscription;
  const quota = summary?.quota_usage;
  const counts = summary?.bulletin_counts;
  const isTrialEligible = Boolean(summary?.profile.is_trial_eligible);
  const bestTrialPlan = summary?.trial_eligible_plans[0] || null;

  const monthlyLimit = quota?.monthly_limit ?? null;
  const monthlyUsed = quota?.monthly_used ?? 0;
  const monthlyPct =
    monthlyLimit === null
      ? 25
      : monthlyLimit === 0
        ? 100
        : Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100));

  const openCreateBulletin = () => {
    setEditingBulletin(null);
    setComposerMode('compose');
    setComposerOpen(true);
  };

  const openEditBulletin = (row: AdvertiserBulletinRow) => {
    setEditingBulletin(row);
    setComposerMode('compose');
    setComposerOpen(true);
  };

  return (
    <>
      <WorkspaceNavShell
        groups={navGroups}
        activeId={activeSection}
        onSelect={(id) => setActiveSection(id as AdvertiserSectionId)}
        navTitle="Advertiser Console"
        contextSwitcherSlot={contextSwitcherSlot}
        testIdPrefix="advertiser-workspace-nav"
        headerSlot={
          <button
            type="button"
            onClick={openCreateBulletin}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 py-2 text-xs font-extrabold text-[var(--ps-accent-fg)] shadow-2xs hover:opacity-95 transition-opacity cursor-pointer"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New Bulletin</span>
          </button>
        }
      >
        <div
          data-testid="advertiser-workspace-root"
          className="space-y-4 sm:space-y-5"
        >
          {/* Top Utility Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3.5 shadow-2xs">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-[var(--ps-text)]">
                  Advertiser &amp; Bulletin Workspace
                </h1>
                {summary?.auto_verify_bulletins && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="h-3 w-3" />
                    <span>Auto-Verified via Plan</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                Manage Churachandpur notices, event pins, YouTube announcements, free trials, and Pay-Per visibility passes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href="/bulletin"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]/50"
              >
                <span>Live Bulletin Feed</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                disabled={isRefreshing}
                onClick={() => void loadWorkspaceData(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs font-bold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={openCreateBulletin}
                data-testid="advertiser-new-bulletin-btn"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-extrabold text-[var(--ps-accent-fg)] shadow-2xs hover:opacity-95 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Publish Bulletin</span>
              </button>
            </div>
          </div>

          {notice && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-xs flex items-start justify-between gap-3 ${
                notice.type === 'error'
                  ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : notice.type === 'success'
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
              }`}
            >
              <div className="flex items-start gap-2">
                {notice.type === 'error' ? (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span className="font-medium">{notice.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-[11px] font-bold underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION 1: OVERVIEW & PLAN QUOTA                                  */}
          {/* ================================================================= */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              {/* 4 Live KPI Cards */}
              {isLoading ? (
                <div
                  data-testid="advertiser-overview-shimmer"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
                >
                  {[0, 1, 2, 3].map((idx) => (
                    <div key={idx} className="dd-shimmer h-28 rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Active Bulletins */}
                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-2 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                        Active Bulletins
                      </span>
                      <Megaphone className="h-4 w-4 text-[var(--ps-accent)]" />
                    </div>
                    <div className="text-2xl font-extrabold text-[var(--ps-text)] tabular-nums">
                      {counts?.published ?? 0}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('published');
                        setActiveSection('bulletins');
                      }}
                      className="text-left text-[11px] font-bold text-[var(--ps-accent)] hover:underline cursor-pointer"
                    >
                      View live notices →
                    </button>
                  </div>

                  {/* Pending Review */}
                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-2 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                        Pending Review / Pay-Per
                      </span>
                      <Clock className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="text-2xl font-extrabold text-[var(--ps-text)] tabular-nums">
                      {counts?.pending ?? 0}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('pending');
                        setActiveSection('bulletins');
                      }}
                      className="text-left text-[11px] font-bold text-[var(--ps-accent)] hover:underline cursor-pointer"
                    >
                      Inspect pending queue →
                    </button>
                  </div>

                  {/* Monthly Quota Meter */}
                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-2 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                        Monthly Quota Meter
                      </span>
                      <Gauge className="h-4 w-4 text-[var(--ps-accent)]" />
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-extrabold text-[var(--ps-text)] tabular-nums">
                        {monthlyUsed} /{' '}
                        {monthlyLimit === null ? '∞' : monthlyLimit}
                      </span>
                      <span className="text-[11px] text-[var(--ps-text-muted)]">
                        this month
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-alt)] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          monthlyLimit !== null && monthlyUsed >= monthlyLimit
                            ? 'bg-rose-500'
                            : 'bg-[var(--ps-accent)]'
                        }`}
                        style={{ width: `${monthlyPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Expiring / Expired Alerts */}
                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-2 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                        Expiring / Expired Alerts
                      </span>
                      <AlertTriangle
                        className={`h-4 w-4 ${
                          expiringAlertsCount > 0
                            ? 'text-rose-500'
                            : 'text-emerald-500'
                        }`}
                      />
                    </div>
                    <div className="text-2xl font-extrabold text-[var(--ps-text)] tabular-nums">
                      {expiringAlertsCount}
                    </div>
                    <div className="text-[11px] text-[var(--ps-text-muted)]">
                      {counts?.expired ?? 0} expired • {counts?.expiring_soon ?? 0} expiring ≤7d
                    </div>
                  </div>
                </div>
              )}

              {/* Active Plan / Free Trial / Default Free Card */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4 shadow-2xs">
                {isLoading ? (
                  <div className="dd-shimmer h-28 rounded-xl" />
                ) : (
                  <>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-accent)]">
                          <Crown className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm sm:text-base font-extrabold text-[var(--ps-text)]">
                              {activeSub?.plan_name || 'Default Free Tier'}
                            </h2>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                                activeSub?.is_trial
                                  ? 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                  : activeSub?.is_default_free
                                    ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                                    : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {activeSub?.is_trial
                                ? 'Free Trial Active'
                                : activeSub?.is_default_free
                                  ? 'Default Free Baseline'
                                  : 'Active Subscription'}
                            </span>
                            {typeof activeSub?.days_remaining === 'number' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--ps-text)]">
                                <Clock className="h-3 w-3 text-[var(--ps-accent)]" />
                                <span>
                                  {activeSub.days_remaining} day
                                  {activeSub.days_remaining === 1 ? '' : 's'} left
                                </span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--ps-text-muted)]">
                            {activeSub?.plan_info}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {isTrialEligible && bestTrialPlan && (
                          <button
                            type="button"
                            disabled={startingTrialPlanId === bestTrialPlan.id}
                            onClick={() =>
                              void handleStartFreeTrial(bestTrialPlan)
                            }
                            data-testid="advertiser-start-trial-btn"
                            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-extrabold text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 cursor-pointer disabled:opacity-50"
                          >
                            <Sparkles className="h-4 w-4" />
                            <span>
                              {startingTrialPlanId === bestTrialPlan.id
                                ? 'Activating Trial…'
                                : `Start ${bestTrialPlan.trial_days}-Day Free Trial`}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveSection('plans_orders')}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
                        >
                          <Crown className="h-3.5 w-3.5" />
                          <span>Plans &amp; Pay-Per Slabs</span>
                        </button>
                      </div>
                    </div>

                    {/* Targeted VIP Plans ("Special Plan for You") */}
                    {(summary?.targeted_vip_plans.length ?? 0) > 0 && (
                      <div
                        data-testid="advertiser-vip-plans-callout"
                        className="rounded-xl border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/8 p-3.5 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ps-accent)] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-accent-fg)]">
                            <Sparkles className="h-3 w-3" />
                            <span>Special Plan for You</span>
                          </span>
                          <span className="text-xs font-bold text-[var(--ps-text)]">
                            Exclusive targeted advertiser plan assigned to your account
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {summary!.targeted_vip_plans.map((vip) => (
                            <div
                              key={vip.id}
                              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-extrabold text-[var(--ps-text)]">
                                  {vip.title}
                                </div>
                                <div className="text-[11px] text-[var(--ps-text-muted)]">
                                  ₹{vip.price_inr.toLocaleString('en-IN')} /{' '}
                                  {vip.duration_days}d • {vip.max_monthly_posts}{' '}
                                  posts/mo
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {isTrialEligible && vip.trial_days > 0 && (
                                  <button
                                    type="button"
                                    disabled={startingTrialPlanId === vip.id}
                                    onClick={() =>
                                      void handleStartFreeTrial(vip)
                                    }
                                    className="min-h-[44px] rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-200 cursor-pointer"
                                  >
                                    {vip.trial_days}d Free Trial
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={subscribingPlanId === vip.id}
                                  onClick={() => void handleSubscribePlan(vip)}
                                  className="min-h-[44px] rounded-xl bg-[var(--ps-accent)] px-3 py-1.5 text-[11px] font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                                >
                                  Activate
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 1-Tap Renew Pay-Per Alerts */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <div>
                      <h3 className="text-xs sm:text-sm font-extrabold text-[var(--ps-text)]">
                        Pay-Per Visibility Alerts &amp; 1-Tap Renewals (
                        {summary?.expiring_bulletins.length ?? 0})
                      </h3>
                      <p className="text-[11px] text-[var(--ps-text-muted)]">
                        Expired notices are soft-hidden from /bulletin but never deleted — renew in 1 tap anytime.
                      </p>
                    </div>
                  </div>
                </div>

                {isLoading ? (
                  <div className="dd-shimmer h-20 rounded-xl" />
                ) : (summary?.expiring_bulletins.length ?? 0) === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-center text-xs text-[var(--ps-text-muted)]">
                    No Pay-Per bulletins are expired or expiring in the next 7 days.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                    {summary!.expiring_bulletins.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-extrabold text-[var(--ps-text)] truncate">
                              {item.title}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                                item.is_expired
                                  ? 'border border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                                  : 'border border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {item.is_expired
                                ? 'Expired — Hidden Publicly'
                                : `Expires in ${Math.max(0, item.days_left)}d`}
                            </span>
                          </div>
                          <div className="text-[11px] text-[var(--ps-text-muted)]">
                            Paid visibility ended/ends:{' '}
                            {formatDateShort(item.paid_until)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setRenewTarget({ id: item.id, title: item.title })
                          }
                          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          <span>Renew Pay-Per</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION 2: MY BULLETINS & NOTICES                                 */}
          {/* ================================================================= */}
          {activeSection === 'bulletins' && (
            <div className="space-y-4">
              {/* Filter Bar */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ps-text-muted)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search your bulletins by headline or detail..."
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-3.5 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={openCreateBulletin}
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-extrabold text-[var(--ps-accent-fg)] cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Bulletin</span>
                  </button>
                </div>

                {/* Horizontal Status Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {(
                    [
                      ['all', 'All Status'],
                      ['published', 'Approved / Live'],
                      ['pending', 'Pending Review'],
                      ['expiring', 'Expiring / Expired'],
                      ['archived', 'Archived'],
                    ] as Array<[StatusFilter, string]>
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStatusFilter(val)}
                      className={`min-h-[38px] shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${
                        statusFilter === val
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Horizontal Type Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {(
                    [
                      ['all', 'All Types'],
                      ['announcement', 'Announcement'],
                      ['job', 'Job Post'],
                      ['event', 'Event'],
                      ['video', 'Video Notice'],
                      ['ad', 'Advertisement'],
                      ['notice', 'Notice'],
                    ] as Array<[TypeFilter, string]>
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setTypeFilter(val)}
                      className={`min-h-[36px] shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                        typeFilter === val
                          ? 'border-[var(--ps-text)] bg-[var(--ps-text)] text-[var(--ps-bg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bulletins List: Desktop Table + Mobile Stacked Collapsible Cards */}
              {isLoading ? (
                <div className="space-y-2.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="dd-shimmer h-20 rounded-2xl" />
                  ))}
                </div>
              ) : filteredBulletins.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
                  <Megaphone className="mx-auto h-7 w-7 text-[var(--ps-text-muted)]" />
                  <p className="text-sm font-bold text-[var(--ps-text)]">
                    No bulletins match your current filters
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Publish a new announcement, job post, event, or YouTube notice using your plan quota or Pay-Per-Post.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={openCreateBulletin}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-extrabold text-[var(--ps-accent-fg)] cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Publish Your First Bulletin</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden lg:block overflow-x-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/70 text-[11px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                        <tr>
                          <th className="px-4 py-3 font-bold">Notice &amp; Type</th>
                          <th className="px-4 py-3 font-bold">Verification</th>
                          <th className="px-4 py-3 font-bold">Visibility Window</th>
                          <th className="px-4 py-3 font-bold text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ps-border)]">
                        {filteredBulletins.map((row) => {
                          const win = getPaidWindowMeta(row.paid_until);
                          const hasVideo = isValidYouTubeVideoId(
                            row.youtube_video_id
                          );
                          const isPending = [
                            'pending',
                            'pending_review',
                            'pending_payment',
                            'draft',
                          ].includes(row.status);
                          const isArchived = row.status === 'archived';

                          return (
                            <tr
                              key={row.id}
                              className="hover:bg-[var(--ps-bg)]/60 transition-colors"
                            >
                              <td className="px-4 py-3.5 max-w-sm">
                                <div className="font-bold text-[var(--ps-text)] line-clamp-1">
                                  {row.title}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
                                  <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                                    {CATEGORY_LABELS[row.category] ||
                                      row.category}
                                  </span>
                                  {hasVideo && (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-600 dark:text-rose-300">
                                      <Video className="h-3 w-3" />
                                      <span>Video</span>
                                    </span>
                                  )}
                                  {row.contact_channels?.venue?.label && (
                                    <span className="inline-flex items-center gap-1 text-[10.5px]">
                                      <MapPin className="h-3 w-3 text-[var(--ps-accent)]" />
                                      <span className="truncate max-w-[160px]">
                                        {row.contact_channels.venue.label}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="px-4 py-3.5">
                                <div className="flex flex-col items-start gap-1">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${
                                      isArchived
                                        ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                                        : isPending
                                          ? 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                          : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                    }`}
                                  >
                                    {isArchived
                                      ? 'Archived'
                                      : isPending
                                        ? 'Pending Review'
                                        : 'Approved'}
                                  </span>
                                  {row.is_verified && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                      <ShieldCheck className="h-3 w-3" />
                                      <span>Auto-Verified via Plan</span>
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="px-4 py-3.5">
                                {win.state === 'expired' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/12 px-2.5 py-0.5 text-[10.5px] font-extrabold text-rose-700 dark:text-rose-300">
                                    Expired — Hidden Publicly
                                  </span>
                                ) : win.state === 'expiring_soon' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/12 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-700 dark:text-amber-300">
                                    Expires in {Math.max(0, win.daysLeft ?? 0)}d
                                  </span>
                                ) : win.state === 'active' ? (
                                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    Paid until {formatDateShort(row.paid_until)}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-[var(--ps-text-muted)]">
                                    Ends {formatDateShort(row.expires_at)}
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-3.5">
                                <div className="flex items-center justify-end gap-1.5">
                                  {(win.state === 'expired' ||
                                    win.state === 'expiring_soon' ||
                                    row.status === 'pending_payment' ||
                                    row.status === 'draft') && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setRenewTarget({
                                          id: row.id,
                                          title: row.title,
                                        })
                                      }
                                      className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3 py-1.5 text-[11px] font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                                    >
                                      <CreditCard className="h-3.5 w-3.5" />
                                      <span>Renew</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openEditBulletin(row)}
                                    className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]/50 cursor-pointer"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={mutatingId === row.id}
                                    onClick={() =>
                                      void handleToggleArchiveBulletin(row)
                                    }
                                    className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                                  >
                                    {isArchived ? (
                                      <Eye className="h-3.5 w-3.5" />
                                    ) : (
                                      <EyeOff className="h-3.5 w-3.5" />
                                    )}
                                    <span>
                                      {isArchived ? 'Republish' : 'Unpublish'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={mutatingId === row.id}
                                    onClick={() =>
                                      void handleDeleteBulletin(row)
                                    }
                                    aria-label={`Delete ${row.title}`}
                                    className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile / Tablet Stacked Collapsible Cards */}
                  <div className="lg:hidden space-y-2.5">
                    {filteredBulletins.map((row) => {
                      const isExpanded = expandedCardId === row.id;
                      const win = getPaidWindowMeta(row.paid_until);
                      const isArchived = row.status === 'archived';
                      const isPending = [
                        'pending',
                        'pending_review',
                        'pending_payment',
                        'draft',
                      ].includes(row.status);

                      return (
                        <div
                          key={row.id}
                          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shadow-2xs"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCardId(isExpanded ? null : row.id)
                            }
                            className="w-full min-h-[56px] p-4 flex items-start justify-between gap-3 text-left cursor-pointer"
                          >
                            <div className="min-w-0 space-y-1.5">
                              <div className="text-sm font-extrabold text-[var(--ps-text)] line-clamp-2">
                                {row.title}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
                                  {CATEGORY_LABELS[row.category] ||
                                    row.category}
                                </span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                    isArchived
                                      ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                                      : isPending
                                        ? 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                        : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                  }`}
                                >
                                  {isArchived
                                    ? 'Archived'
                                    : isPending
                                      ? 'Pending Review'
                                      : 'Approved'}
                                </span>
                                {win.state === 'expired' && (
                                  <span className="rounded-full border border-rose-500/35 bg-rose-500/12 px-2 py-0.5 text-[10px] font-extrabold text-rose-700 dark:text-rose-300">
                                    Expired — Hidden Publicly
                                  </span>
                                )}
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-[var(--ps-text-muted)] shrink-0 mt-1" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-[var(--ps-text-muted)] shrink-0 mt-1" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/60 p-4 space-y-3 text-xs">
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--ps-text-muted)]">
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3.5 w-3.5" />
                                  <span>
                                    Created {formatDateShort(row.created_at)}
                                  </span>
                                </span>
                                {row.paid_until && (
                                  <span>
                                    Paid until {formatDateShort(row.paid_until)}
                                  </span>
                                )}
                                {row.is_verified && (
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    <span>Auto-Verified via Plan</span>
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                {(win.state === 'expired' ||
                                  win.state === 'expiring_soon' ||
                                  row.status === 'pending_payment' ||
                                  row.status === 'draft') && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRenewTarget({
                                        id: row.id,
                                        title: row.title,
                                      })
                                    }
                                    className="col-span-2 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 py-2 text-xs font-extrabold text-[var(--ps-accent-fg)] cursor-pointer"
                                  >
                                    <CreditCard className="h-4 w-4" />
                                    <span>Renew Pay-Per Pass</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEditBulletin(row)}
                                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs font-bold text-[var(--ps-text)] cursor-pointer"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={mutatingId === row.id}
                                  onClick={() =>
                                    void handleToggleArchiveBulletin(row)
                                  }
                                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs font-bold text-[var(--ps-text)] cursor-pointer"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                  <span>
                                    {isArchived ? 'Republish' : 'Unpublish'}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  disabled={mutatingId === row.id}
                                  onClick={() => void handleDeleteBulletin(row)}
                                  className="col-span-2 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Delete Permanently</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION 3: PLANS, TRIALS & PAY-PER ORDERS                         */}
          {/* ================================================================= */}
          {activeSection === 'plans_orders' && (
            <div className="space-y-4">
              {/* Public & Targeted Advertiser Plans */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3.5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
                      Eligible Subscription Plans &amp; Free Trials
                    </h2>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Upgrade monthly bulletin quotas, enable YouTube video embeds, or activate your one-time free trial.
                    </p>
                  </div>
                </div>

                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[0, 1].map((i) => (
                      <div key={i} className="dd-shimmer h-40 rounded-2xl" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {publicPlans.map((plan) => {
                      const isVip = plan.target_scope === 'selected_users';
                      const isCurrent = activeSub?.plan_id === plan.id;
                      return (
                        <div
                          key={plan.id}
                          className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 ${
                            isVip
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/6'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                                    {plan.title}
                                  </h3>
                                  {isVip && (
                                    <span className="rounded-full bg-[var(--ps-accent)] px-2 py-0.5 text-[10px] font-extrabold text-[var(--ps-accent-fg)]">
                                      Special Plan for You
                                    </span>
                                  )}
                                  {isCurrent && (
                                    <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                      Active
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                                  {plan.info}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-base font-extrabold text-[var(--ps-text)] tabular-nums">
                                  ₹{plan.price_inr.toLocaleString('en-IN')}
                                </div>
                                <div className="text-[10px] text-[var(--ps-text-muted)]">
                                  / {plan.duration_days}d
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5 text-[10.5px] text-[var(--ps-text-muted)]">
                              <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 font-semibold">
                                {plan.max_monthly_posts} posts/mo
                              </span>
                              <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 font-semibold">
                                {plan.max_active_bulletins} active max
                              </span>
                              {plan.allow_youtube && (
                                <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 font-semibold">
                                  YouTube Embeds
                                </span>
                              )}
                              {plan.auto_verify_bulletins && (
                                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-700 dark:text-emerald-300">
                                  Auto-Verify
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {isTrialEligible && plan.trial_days > 0 && !isCurrent && (
                              <button
                                type="button"
                                disabled={startingTrialPlanId === plan.id}
                                onClick={() => void handleStartFreeTrial(plan)}
                                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-extrabold text-amber-800 dark:text-amber-200 cursor-pointer"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>Start {plan.trial_days}d Free Trial</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={subscribingPlanId === plan.id}
                              onClick={() => void handleSubscribePlan(plan)}
                              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 py-2 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                            >
                              <Crown className="h-3.5 w-3.5" />
                              <span>
                                {isCurrent ? 'Renew via UPI' : 'Subscribe via UPI'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Transparent Pay-Per Bulletin Duration Slabs & Boosts */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3.5 shadow-2xs">
                <div>
                  <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
                    Pay-Per Bulletin Duration Slabs &amp; Boosts
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Live rates configured in DD oodle — publish or renew individual notices without a monthly plan.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {payPerConfig.duration_slabs.map((slab) => (
                    <div
                      key={slab.id}
                      className={`rounded-xl border p-3 ${
                        slab.is_popular
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/8'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-extrabold text-[var(--ps-text)]">
                          {slab.days} Days
                        </span>
                        {slab.is_popular && (
                          <span className="rounded-full bg-[var(--ps-accent)] px-2 py-0.5 text-[9px] font-extrabold text-[var(--ps-accent-fg)]">
                            Popular
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-lg font-extrabold text-[var(--ps-text)] tabular-nums">
                        ₹{Number(slab.price_inr).toLocaleString('en-IN')}
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-muted)]">
                        {slab.label}
                      </div>
                    </div>
                  ))}
                </div>

                {payPerConfig.addons.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Optional Add-On Boosts
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {payPerConfig.addons.map((addon) => (
                        <div
                          key={addon.id}
                          className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--ps-text)]">
                              {addon.label}
                            </div>
                            {addon.description && (
                              <div className="text-[11px] text-[var(--ps-text-muted)]">
                                {addon.description}
                              </div>
                            )}
                          </div>
                          <span className="shrink-0 font-mono text-xs font-extrabold text-[var(--ps-accent)]">
                            +₹{Number(addon.price_inr).toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Advertiser's Own Pay-Per Orders History */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3 shadow-2xs">
                <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
                  Your Pay-Per Bulletin Order History (
                  {summary?.recent_pay_per_orders.length ?? 0})
                </h2>

                {isLoading ? (
                  <div className="dd-shimmer h-28 rounded-xl" />
                ) : (summary?.recent_pay_per_orders.length ?? 0) === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-5 text-center text-xs text-[var(--ps-text-muted)]">
                    You have not submitted any Pay-Per Bulletin orders yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                    {summary!.recent_pay_per_orders.map((ord) => {
                      const statusStyle =
                        ord.status === 'paid'
                          ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : ord.status === 'rejected'
                            ? 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                            : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300';
                      const statusLabel =
                        ord.status === 'paid'
                          ? 'Paid'
                          : ord.status === 'rejected'
                            ? 'Rejected'
                            : ord.status === 'pending_verification'
                              ? 'Pending Verification'
                              : ord.status;

                      return (
                        <div
                          key={ord.id}
                          className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-extrabold text-[var(--ps-text)] truncate">
                                {ord.target_title}
                              </span>
                              <span
                                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold ${statusStyle}`}
                              >
                                {statusLabel}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
                              <span>{ord.duration_days} days</span>
                              <span>•</span>
                              <span className="uppercase">
                                {ord.payment_method}
                              </span>
                              {ord.upi_utr_ref && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono">
                                    UTR: {ord.upi_utr_ref}
                                  </span>
                                </>
                              )}
                              <span>•</span>
                              <span>{formatDateShort(ord.created_at)}</span>
                            </div>
                            {ord.status === 'rejected' && ord.review_notes && (
                              <div className="mt-1 rounded-lg border border-rose-500/30 bg-rose-500/8 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-300">
                                <strong>Reviewer Note:</strong>{' '}
                                {ord.review_notes}
                              </div>
                            )}
                          </div>
                          <div className="text-left sm:text-right shrink-0">
                            <div className="text-sm font-extrabold text-[var(--ps-text)] tabular-nums">
                              ₹{Number(ord.amount_inr).toLocaleString('en-IN')}
                            </div>
                            {ord.paid_until && (
                              <div className="text-[10.5px] text-emerald-700 dark:text-emerald-300">
                                Active until {formatDateShort(ord.paid_until)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION 4: FEATURED & PROMO REQUESTS (`public.featured_requests`) */}
          {/* ================================================================= */}
          {activeSection === 'featured_requests' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
                    Homepage Featured &amp; Banner Promo Requests
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Request curated spotlight placement on the DD oodle homepage for major local events, openings, or seasonal campaigns.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewFeaturedModal}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-extrabold text-[var(--ps-accent-fg)] cursor-pointer"
                >
                  <Star className="h-4 w-4" />
                  <span>Request Spotlight</span>
                </button>
              </div>

              {isLoading ? (
                <div className="dd-shimmer h-28 rounded-xl" />
              ) : featuredRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No featured placement requests yet. Click &ldquo;Request Spotlight&rdquo; to submit a campaign inquiry.
                </div>
              ) : (
                <div className="divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                  {featuredRequests.map((req) => (
                    <div
                      key={req.id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-extrabold text-[var(--ps-text)]">
                            {FEATURED_SLOT_LABELS[req.slot_section] || req.slot_section}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                            {req.request_code}
                          </span>
                          <span className="rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                            {req.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {req.duration_days} days • ₹
                          {Number(req.quoted_fee_inr || 0).toLocaleString('en-IN')} •{' '}
                          {req.contact_phone} • {formatDateShort(req.created_at)}
                        </div>
                        {req.notes && (
                          <p className="text-[11px] text-[var(--ps-text)]/80">
                            {req.notes}
                          </p>
                        )}
                        {req.reviewer_notes && (
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            Review: {req.reviewer_notes}
                          </p>
                        )}
                      </div>
                      {WITHDRAWABLE_FEATURED_STATUSES.has(req.status) && (
                        <button
                          type="button"
                          disabled={mutatingId === req.id}
                          onClick={() => void handleCancelFeaturedRequest(req)}
                          className="min-h-[44px] shrink-0 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 cursor-pointer"
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </WorkspaceNavShell>

      {/* Bulletin Create / Edit FormModal */}
      <BulletinComposerModal
        isOpen={composerOpen}
        onClose={() => {
          setComposerOpen(false);
          setEditingBulletin(null);
        }}
        initialMode={composerMode}
        editingBulletin={editingBulletin}
        onPublished={() => {
          void loadWorkspaceData(true);
        }}
      />

      {/* 1-Tap Pay-Per Renewal Modal */}
      {renewTarget && (
        <PayPerCheckoutModal
          open={Boolean(renewTarget)}
          onClose={() => setRenewTarget(null)}
          moduleKey="bulletin_post"
          targetTable="bulletins"
          targetId={renewTarget.id}
          targetTitle={renewTarget.title}
          onSuccess={() => {
            setRenewTarget(null);
            setNotice({
              type: 'success',
              text: `Pay-Per renewal order submitted for "${renewTarget.title}". Visibility activates once verified.`,
            });
            void loadWorkspaceData(true);
          }}
        />
      )}

      {/* Subscription UPI Payment Modal */}
      {paymentIntent && (
        <UniversalPaymentModal
          open={Boolean(paymentIntent)}
          intent={paymentIntent}
          upiId={paymentUpiDetails.upiId}
          upiPayeeName={paymentUpiDetails.upiPayeeName}
          title="Advertiser Subscription Checkout"
          onClose={() => setPaymentIntent(null)}
          onSubmitted={() => {
            setPaymentIntent(null);
            setNotice({
              type: 'success',
              text: 'Subscription payment proof submitted for verification.',
            });
            void loadWorkspaceData(true);
          }}
        />
      )}

      {/* Featured Request Modal (canonical public.featured_requests insert) */}
      <GetFeaturedModal
        open={featuredModalOpen}
        onClose={() => {
          setFeaturedModalOpen(false);
          void loadWorkspaceData(true);
        }}
        hubId={activeHub?.id ?? null}
        hubName={activeHub?.name || 'your hub'}
      />

      {confirmDialog}
    </>
  );
}

export default AdvertiserWorkspace;
