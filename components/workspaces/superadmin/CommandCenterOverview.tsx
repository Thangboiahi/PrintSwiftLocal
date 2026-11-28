'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  IndianRupee,
  MapPin,
  MousePointerClick,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

type WindowDays = 7 | 30 | 90;

interface CommandCenterSummary {
  visits: number;
  unique_sessions: number;
  clicks: number;
  leads_whatsapp: number;
  active_bookings_transactions: number;
  verified_escrow_inr: number;
  pending_queues: {
    listings: number;
    partner_applications: number;
    bulletins: number;
    civic_reports: number;
    escrow_disputes: number;
    total: number;
  };
}

interface DailyPoint {
  date: string;
  label: string;
  visits: number;
  clicks: number;
  leads: number;
  transactions: number;
}

interface PillarDailyPoint {
  date: string;
  label: string;
  pick_n_drop: number;
  vehicles: number;
  subscriptions_bulletins: number;
  marketplace_leads: number;
}

interface FeatureShare {
  key: string;
  name: string;
  value: number;
}

interface FunnelStage {
  key: string;
  stage: string;
  count: number;
}

interface TopShortcut {
  target_id: string;
  root_key: string | null;
  clicks: number;
}

interface TopLocality {
  locality: string;
  events: number;
}

interface CommandCenterMetricsPayload {
  window_days: number;
  generated_at: string;
  summary: CommandCenterSummary;
  daily_series: DailyPoint[];
  pillar_breakdown: {
    daily: PillarDailyPoint[];
    totals: {
      pick_n_drop: number;
      vehicles: number;
      subscriptions_bulletins: number;
      marketplace_leads: number;
    };
  };
  feature_distribution: FeatureShare[];
  conversion_funnel: FunnelStage[];
  top_shortcuts: TopShortcut[];
  top_localities: TopLocality[];
  system_health: {
    pod_pending_purge_count: number;
    pending_manual_payments: number;
    total_analytics_rows_90d: number;
    last_event_at: string | null;
  };
}

export interface CommandCenterOverviewProps {
  onNavigate: (tab: string, subView?: string) => void;
  localPendingCounts?: {
    listings?: number;
    verifications?: number;
    moderation?: number;
    totalListings?: number;
  };
}

const DONUT_COLORS = [
  '#2563EB',
  '#0D9488',
  '#D97706',
  '#7C3AED',
  '#E11D48',
  '#0284C7',
  '#65A30D',
  '#64748B',
];

const FUNNEL_COLORS = ['#2563EB', '#0284C7', '#0D9488', '#16A34A'];

function formatInr(val: number): string {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.round(Number(val) || 0));
}

function formatCompact(val: number): string {
  const n = Number(val) || 0;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function buildFallbackMetrics(
  windowDays: WindowDays,
  localPendingCounts?: CommandCenterOverviewProps['localPendingCounts']
): CommandCenterMetricsPayload {
  const listingsPending = localPendingCounts?.listings ?? 0;
  const modPending = localPendingCounts?.moderation ?? 0;
  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    summary: {
      visits: 0,
      unique_sessions: 0,
      clicks: 0,
      leads_whatsapp: 0,
      active_bookings_transactions: 0,
      verified_escrow_inr: 0,
      pending_queues: {
        listings: listingsPending,
        partner_applications: 0,
        bulletins: 0,
        civic_reports: modPending,
        escrow_disputes: 0,
        total: listingsPending + modPending,
      },
    },
    daily_series: [],
    pillar_breakdown: {
      daily: [],
      totals: {
        pick_n_drop: 0,
        vehicles: 0,
        subscriptions_bulletins: 0,
        marketplace_leads: 0,
      },
    },
    feature_distribution: [],
    conversion_funnel: [
      { key: 'visit', stage: 'Page Visits', count: 0 },
      { key: 'listing_view', stage: 'Listing Clicks', count: 0 },
      { key: 'lead', stage: 'Enquiry / WhatsApp', count: 0 },
      { key: 'booking', stage: 'Bookings & Orders', count: 0 },
    ],
    top_shortcuts: [],
    top_localities: [],
    system_health: {
      pod_pending_purge_count: 0,
      pending_manual_payments: 0,
      total_analytics_rows_90d: 0,
      last_event_at: null,
    },
  };
}

export function CommandCenterOverview({
  onNavigate,
  localPendingCounts,
}: CommandCenterOverviewProps) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState<CommandCenterMetricsPayload | null>(null);
  const [rpcNotice, setRpcNotice] = useState<string | null>(null);

  const localPendingCountsRef = useRef(localPendingCounts);
  localPendingCountsRef.current = localPendingCounts;
  const hasLoadedOnceRef = useRef(false);

  const demoAuthEnabled =
    String(process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH || '').toLowerCase() === 'true';

  const loadMetrics = useCallback(
    async (days: WindowDays, isManualRefresh = false) => {
      if (isManualRefresh || hasLoadedOnceRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setRpcNotice(null);

      if (!isSupabaseConfigured()) {
        setMetrics(buildFallbackMetrics(days, localPendingCountsRef.current));
        setRpcNotice(
          'Live analytics unavailable in offline demo mode. Showing local queue summary.'
        );
        hasLoadedOnceRef.current = true;
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        const { data, error } = await supabase.rpc('get_command_center_metrics', {
          p_days: days,
        });

        if (error || !data || typeof data !== 'object') {
          setMetrics(buildFallbackMetrics(days, localPendingCountsRef.current));
          setRpcNotice(
            error?.message?.includes('get_command_center_metrics')
              ? 'Run SQL migration 20261125_pass_v15f_command_center_telemetry.sql to activate live telemetry charts.'
              : error?.message || 'Unable to load telemetry metrics right now.'
          );
        } else {
          setMetrics(data as CommandCenterMetricsPayload);
        }
      } catch (err) {
        setMetrics(buildFallbackMetrics(days, localPendingCountsRef.current));
        setRpcNotice(
          err instanceof Error
            ? err.message
            : 'Unable to load Command Center telemetry.'
        );
      } finally {
        hasLoadedOnceRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await loadMetrics(windowDays, false);
    };
    void run();
    return () => {
      active = false;
    };
  }, [windowDays, loadMetrics]);

  const effective = useMemo(
    () => metrics ?? buildFallbackMetrics(windowDays, localPendingCounts),
    [metrics, windowDays, localPendingCounts]
  );

  const featureTotal = useMemo(
    () =>
      effective.feature_distribution.reduce(
        (sum, item) => sum + (Number(item.value) || 0),
        0
      ),
    [effective.feature_distribution]
  );

  const maxShortcutClicks = useMemo(
    () =>
      Math.max(
        1,
        ...effective.top_shortcuts.map((s) => Number(s.clicks) || 0)
      ),
    [effective.top_shortcuts]
  );

  const maxLocalityEvents = useMemo(
    () =>
      Math.max(
        1,
        ...effective.top_localities.map((l) => Number(l.events) || 0)
      ),
    [effective.top_localities]
  );

  const pillarTotals = effective.pillar_breakdown.totals;
  const hasDailyTraffic = effective.daily_series.some(
    (d) => d.visits > 0 || d.clicks > 0 || d.transactions > 0
  );
  const hasPillarData =
    pillarTotals.pick_n_drop +
      pillarTotals.vehicles +
      pillarTotals.subscriptions_bulletins +
      pillarTotals.marketplace_leads >
    0;

  return (
    <div
      data-testid="superadmin-command-center-overview"
      className="space-y-6"
    >
      {/* Top Bar: Window Selector + Refresh */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--ps-accent)] shrink-0" aria-hidden="true" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Platform Command Centre
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
            Live webapp telemetry, operational transaction pillars, conversion funnel, and pending queues.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Analytics time range"
            className="inline-flex rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1"
          >
            {([7, 30, 90] as WindowDays[]).map((days) => {
              const active = windowDays === days;
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => setWindowDays(days)}
                  aria-pressed={active}
                  className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--ps-accent)] text-white shadow-sm'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {days}d
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void loadMetrics(windowDays, true)}
            disabled={refreshing}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] disabled:opacity-60 transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {rpcNotice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{rpcNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadMetrics(windowDays, true)}
            disabled={refreshing}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-600/30 bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] disabled:opacity-60 cursor-pointer shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* 1. LIVE KPI CARDS */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
            >
              <div className="dd-shimmer h-3.5 w-24 rounded" />
              <div className="dd-shimmer h-8 w-28 rounded" />
              <div className="dd-shimmer h-3 w-36 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* Visits */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--ps-text-muted)]">
              <span>Visits ({windowDays}d)</span>
              <Eye className="h-4 w-4 text-[var(--ps-accent)]" aria-hidden="true" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--ps-text)]">
              {formatCompact(effective.summary.visits)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
              {formatCompact(effective.summary.unique_sessions)} anonymous sessions
            </div>
          </div>

          {/* Feature Clicks & Leads */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--ps-text-muted)]">
              <span>Clicks &amp; Leads</span>
              <MousePointerClick className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--ps-text)]">
              {formatCompact(effective.summary.clicks)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
              {formatCompact(effective.summary.leads_whatsapp)} WhatsApp &amp; enquiry leads
            </div>
          </div>

          {/* Transactions & Verified Escrow */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--ps-text-muted)]">
              <span>Verified Escrow &amp; Tx</span>
              <IndianRupee className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--ps-text)]">
              ₹{formatInr(effective.summary.verified_escrow_inr)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
              {formatCompact(effective.summary.active_bookings_transactions)} orders &amp; bookings in {windowDays}d
            </div>
          </div>

          {/* Pending Moderation Queues */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--ps-text-muted)]">
              <span>Pending Queues</span>
              <ShieldAlert
                className={`h-4 w-4 ${
                  effective.summary.pending_queues.total > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
                aria-hidden="true"
              />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-[var(--ps-text)]">
              {effective.summary.pending_queues.total}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onNavigate('listings')}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                Listings: {effective.summary.pending_queues.listings}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('partner_applications')}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                Partners: {effective.summary.pending_queues.partner_applications}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('escrow_disputes')}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                Escrow: {effective.summary.pending_queues.escrow_disputes}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('bulletins')}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                Bulletins: {effective.summary.pending_queues.bulletins}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CHARTS ROW 1: Daily Traffic AreaChart + Pillar Breakdown Stacked BarChart */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4">
            <div className="dd-shimmer h-4 w-48 rounded" />
            <div className="dd-shimmer h-[240px] w-full rounded-xl" />
          </div>
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4">
            <div className="dd-shimmer h-4 w-52 rounded" />
            <div className="dd-shimmer h-[240px] w-full rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* AreaChart: Daily Traffic, Visits & Clicks */}
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Daily Traffic, Visits &amp; Clicks
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Page views vs feature clicks over the last {windowDays} days
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-[var(--ps-accent)] shrink-0" aria-hidden="true" />
            </div>

            {effective.daily_series.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-[var(--ps-border)] text-xs text-[var(--ps-text-muted)]">
                No telemetry series yet for this window.
              </div>
            ) : (
              <div className="h-[250px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={effective.daily_series}
                    margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="ccVisitsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="ccClicksFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0D9488" stopOpacity={0.26} />
                        <stop offset="95%" stopColor="#0D9488" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid var(--ps-border)',
                        backgroundColor: 'var(--ps-surface)',
                        color: 'var(--ps-text)',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Area
                      type="monotone"
                      dataKey="visits"
                      name="Visits"
                      stroke="#2563EB"
                      strokeWidth={2}
                      fill="url(#ccVisitsFill)"
                    />
                    <Area
                      type="monotone"
                      dataKey="clicks"
                      name="Feature Clicks"
                      stroke="#0D9488"
                      strokeWidth={2}
                      fill="url(#ccClicksFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {!hasDailyTraffic && effective.daily_series.length > 0 && (
              <p className="mt-2 text-[11px] text-[var(--ps-text-muted)]">
                Telemetry stream is active — metrics populate automatically as visitors browse and tap shortcuts.
              </p>
            )}
          </section>

          {/* Stacked BarChart: Transactions & Activity by Pillar */}
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Transactions &amp; Activity by Pillar
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Pick N Drop ({pillarTotals.pick_n_drop}) · Vehicles ({pillarTotals.vehicles}) · Subs/Bulletins ({pillarTotals.subscriptions_bulletins}) · Marketplace ({pillarTotals.marketplace_leads})
                </p>
              </div>
            </div>

            {effective.pillar_breakdown.daily.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-[var(--ps-border)] text-xs text-[var(--ps-text-muted)]">
                No pillar transactions recorded in this window.
              </div>
            ) : (
              <div className="h-[250px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={effective.pillar_breakdown.daily}
                    margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid var(--ps-border)',
                        backgroundColor: 'var(--ps-surface)',
                        color: 'var(--ps-text)',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar
                      dataKey="pick_n_drop"
                      name="Pick N Drop"
                      stackId="pillar"
                      fill="#2563EB"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="vehicles"
                      name="Vehicles"
                      stackId="pillar"
                      fill="#0D9488"
                    />
                    <Bar
                      dataKey="subscriptions_bulletins"
                      name="Subs / Bulletins"
                      stackId="pillar"
                      fill="#D97706"
                    />
                    <Bar
                      dataKey="marketplace_leads"
                      name="Marketplace Leads"
                      stackId="pillar"
                      fill="#7C3AED"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {!hasPillarData && effective.pillar_breakdown.daily.length > 0 && (
              <p className="mt-2 text-[11px] text-[var(--ps-text-muted)]">
                No orders, bookings, or enquiries recorded yet in the selected {windowDays}-day period.
              </p>
            )}
          </section>
        </div>
      )}

      {/* 3. CHARTS ROW 2: Feature Distribution Donut + Conversion Funnel */}
      {!loading && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* Donut Chart: Traffic & Click Distribution across Webapp Features */}
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Feature Traffic Distribution
              </h3>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Share of events across Home, Explore, Pick N Drop, Vehicles, Marketplace &amp; Bulletins
              </p>
            </div>

            {effective.feature_distribution.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-[var(--ps-border)] text-xs text-[var(--ps-text-muted)]">
                Feature distribution will appear once visitor events are recorded.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 items-center">
                <div className="h-[210px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={effective.feature_distribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={82}
                        paddingAngle={2}
                      >
                        {effective.feature_distribution.map((entry, idx) => (
                          <Cell
                            key={entry.key}
                            fill={DONUT_COLORS[idx % DONUT_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          borderRadius: '12px',
                          border: '1px solid var(--ps-border)',
                          backgroundColor: 'var(--ps-surface)',
                          color: 'var(--ps-text)',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  {effective.feature_distribution.map((item, idx) => {
                    const pct =
                      featureTotal > 0
                        ? Math.round((item.value / featureTotal) * 100)
                        : 0;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                DONUT_COLORS[idx % DONUT_COLORS.length],
                            }}
                            aria-hidden="true"
                          />
                          <span className="truncate font-medium text-[var(--ps-text)]">
                            {item.name}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] font-semibold text-[var(--ps-text-muted)] shrink-0">
                          {item.value} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Horizontal Bar Chart: Conversion Funnel */}
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Discovery-to-Booking Funnel
              </h3>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Visit → Listing View → Enquiry / WhatsApp → Bookings &amp; Orders
              </p>
            </div>

            <div className="h-[220px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={effective.conversion_funnel}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 16, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} strokeOpacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={118}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid var(--ps-border)',
                      backgroundColor: 'var(--ps-surface)',
                      color: 'var(--ps-text)',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Events" radius={[0, 6, 6, 0]} barSize={24}>
                    {effective.conversion_funnel.map((entry, idx) => (
                      <Cell
                        key={entry.key}
                        fill={FUNNEL_COLORS[idx % FUNNEL_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      {/* 4. TOP SHORTCUTS & TOP LOCALITIES */}
      {!loading && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--ps-accent)]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Top Clicked Shortcuts
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('homepage_builder')}
                className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-[var(--ps-accent)] hover:underline cursor-pointer"
              >
                Edit Shortcuts
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {effective.top_shortcuts.length === 0 ? (
              <p className="text-xs text-[var(--ps-text-muted)] py-4">
                No shortcut clicks recorded yet in the last {windowDays} days.
              </p>
            ) : (
              <div className="space-y-2.5">
                {effective.top_shortcuts.map((row) => {
                  const widthPct = Math.max(
                    8,
                    Math.round((row.clicks / maxShortcutClicks) * 100)
                  );
                  return (
                    <div key={row.target_id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--ps-text)] truncate pr-2">
                          {row.target_id}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-[var(--ps-text-muted)] shrink-0">
                          {row.clicks}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[var(--ps-bg)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--ps-accent)]"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Top Active Localities
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('homepage_builder')}
                className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-[var(--ps-accent)] hover:underline cursor-pointer"
              >
                Manage Hubs
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {effective.top_localities.length === 0 ? (
              <p className="text-xs text-[var(--ps-text-muted)] py-4">
                Locality activity will appear as users tap neighbourhood chips and listings.
              </p>
            ) : (
              <div className="space-y-2.5">
                {effective.top_localities.map((row) => {
                  const widthPct = Math.max(
                    8,
                    Math.round((row.events / maxLocalityEvents) * 100)
                  );
                  return (
                    <div key={row.locality} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--ps-text)] truncate pr-2">
                          {row.locality}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-[var(--ps-text-muted)] shrink-0">
                          {row.events}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[var(--ps-bg)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-teal-600 dark:bg-teal-400"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 5. COMPACT SYSTEM HEALTH STRIP */}
      <section
        data-testid="command-center-system-health-strip"
        className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3.5"
      >
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-semibold ${
              demoAuthEnabled
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            {demoAuthEnabled ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              Demo Auth: {demoAuthEnabled ? 'ENABLED (Disable for Prod)' : 'Disabled'}
            </span>
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 font-semibold text-[var(--ps-text)]">
            <span>Pending Approvals:</span>
            <span className="font-mono">{effective.summary.pending_queues.total}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-semibold ${
              effective.system_health.pod_pending_purge_count > 0
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              48h POD Purge:{' '}
              {effective.system_health.pod_pending_purge_count === 0
                ? 'Clear'
                : `${effective.system_health.pod_pending_purge_count} overdue`}
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('system_health')}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
        >
          <span>Open System Health</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}

export default CommandCenterOverview;
