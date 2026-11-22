'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Gift,
  Loader2,
  Lock,
  MapPin,
  Megaphone,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Truck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
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
import type { ServiceHubRecord } from '@/lib/config/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';

export type PartnerApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected';

export type PartnerApplicationTrack =
  | 'business_owner'
  | 'driver'
  | 'advertiser';

interface KycDocumentEntry {
  doc_type: string;
  label: string;
  storage_path: string;
  bucket_id?: string;
  uploaded_at?: string;
}

interface PartnerApplicationRecord {
  id: string;
  application_code: string;
  applicant_id: string;
  hub_id: string;
  application_type: PartnerApplicationTrack;
  status: PartnerApplicationStatus;
  full_name: string;
  phone: string;
  whatsapp_number: string | null;
  preferred_contact: 'whatsapp' | 'phone';
  locality: string | null;
  business_name: string | null;
  business_vertical: string | null;
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  organization_name: string | null;
  registration_fee_inr: number;
  fee_acknowledged: boolean;
  referral_code_used: string | null;
  kyc_documents: KycDocumentEntry[];
  applicant_notes: string | null;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerApplicationsPanelProps {
  /** When provided, restricts applications to this single service hub. Omit for global Super-Admin desk. */
  hubId?: string | null;
  hubs?: ServiceHubRecord[];
  onPendingCountChange?: (count: number) => void;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const STATUS_OPTIONS: Array<{
  id: 'all' | PartnerApplicationStatus;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'changes_requested', label: 'Changes Requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const TRACK_OPTIONS: Array<{
  id: 'all' | PartnerApplicationTrack;
  label: string;
}> = [
  { id: 'all', label: 'All Tracks' },
  { id: 'business_owner', label: 'Business' },
  { id: 'driver', label: 'Driver' },
  { id: 'advertiser', label: 'Advertiser' },
];

function getTrackMeta(track: PartnerApplicationTrack) {
  switch (track) {
    case 'driver':
      return {
        label: 'Driver / Rider',
        icon: Truck,
        pillClass:
          'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
      };
    case 'advertiser':
      return {
        label: 'Advertiser',
        icon: Megaphone,
        pillClass:
          'bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/25',
      };
    default:
      return {
        label: 'Business Owner',
        icon: Store,
        pillClass:
          'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25',
      };
  }
}

function getStatusBadge(status: PartnerApplicationStatus): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      };
    case 'under_review':
      return {
        label: 'Under Review',
        cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
      };
    case 'changes_requested':
      return {
        label: 'Changes Requested',
        cls: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
      };
    default:
      return {
        label: 'Submitted',
        cls: 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border-[var(--ps-accent)]/30',
      };
  }
}

function normalizeKycDocs(raw: unknown): KycDocumentEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: KycDocumentEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const storagePath = String(obj.storage_path || '').trim();
    if (!storagePath) continue;
    out.push({
      doc_type: String(obj.doc_type || 'document'),
      label: String(obj.label || obj.doc_type || 'KYC Document'),
      storage_path: storagePath,
      bucket_id: obj.bucket_id ? String(obj.bucket_id) : 'kyc-documents',
      uploaded_at: obj.uploaded_at ? String(obj.uploaded_at) : undefined,
    });
  }
  return out;
}

export function PartnerApplicationsPanel({
  hubId = null,
  hubs = [],
  onPendingCountChange,
  onNotice,
}: PartnerApplicationsPanelProps) {
  const { session } = useAuth();
  const { setStatus } = useAppStatus();
  const { confirm: confirmDialog, dialog: confirmModal } = useConfirmDialog();

  const [applications, setApplications] = useState<PartnerApplicationRecord[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | PartnerApplicationStatus
  >('all');
  const [trackFilter, setTrackFilter] = useState<
    'all' | PartnerApplicationTrack
  >('all');
  const [hubFilter, setHubFilter] = useState<string>('all');

  const [selectedApp, setSelectedApp] =
    useState<PartnerApplicationRecord | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(
    null
  );
  const [activePreview, setActivePreview] = useState<{
    label: string;
    storagePath: string;
    signedUrl: string;
    expiresInSeconds: number;
    isPdf: boolean;
  } | null>(null);

  const hubMap = useMemo(() => {
    const map = new Map<string, ServiceHubRecord>();
    for (const h of hubs) {
      map.set(h.id, h);
    }
    return map;
  }, [hubs]);

  const hubFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = [
      { value: 'all', label: 'All Service Hubs' },
    ];
    for (const h of hubs) {
      list.push({
        value: h.id,
        label: h.name,
        description: h.state,
      });
    }
    return list;
  }, [hubs]);

  const fetchApplications = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      let query = supabase
        .from('partner_applications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(250);

      if (hubId) {
        query = query.eq('hub_id', hubId);
      }

      const { data, error } = await query;
      if (error) {
        setLoadError(error.message);
        return;
      }

      const rows: PartnerApplicationRecord[] = ((data ?? []) as Record<
        string,
        unknown
      >[]).map((r) => ({
        id: String(r.id),
        application_code: String(r.application_code || ''),
        applicant_id: String(r.applicant_id || ''),
        hub_id: String(r.hub_id || ''),
        application_type: (r.application_type ||
          'business_owner') as PartnerApplicationTrack,
        status: (r.status || 'submitted') as PartnerApplicationStatus,
        full_name: String(r.full_name || ''),
        phone: String(r.phone || ''),
        whatsapp_number: r.whatsapp_number ? String(r.whatsapp_number) : null,
        preferred_contact:
          r.preferred_contact === 'phone' ? 'phone' : 'whatsapp',
        locality: r.locality ? String(r.locality) : null,
        business_name: r.business_name ? String(r.business_name) : null,
        business_vertical: r.business_vertical
          ? String(r.business_vertical)
          : null,
        vehicle_type: r.vehicle_type ? String(r.vehicle_type) : null,
        vehicle_reg_no: r.vehicle_reg_no ? String(r.vehicle_reg_no) : null,
        organization_name: r.organization_name
          ? String(r.organization_name)
          : null,
        registration_fee_inr: Number(r.registration_fee_inr ?? 0),
        fee_acknowledged: Boolean(r.fee_acknowledged),
        referral_code_used: r.referral_code_used
          ? String(r.referral_code_used)
          : null,
        kyc_documents: normalizeKycDocs(r.kyc_documents),
        applicant_notes: r.applicant_notes ? String(r.applicant_notes) : null,
        reviewer_id: r.reviewer_id ? String(r.reviewer_id) : null,
        reviewer_notes: r.reviewer_notes ? String(r.reviewer_notes) : null,
        reviewed_at: r.reviewed_at ? String(r.reviewed_at) : null,
        created_at: String(r.created_at || new Date().toISOString()),
        updated_at: String(r.updated_at || new Date().toISOString()),
      }));

      setApplications(rows);
      const pendingCount = rows.filter(
        (row) => row.status === 'submitted' || row.status === 'under_review'
      ).length;
      onPendingCountChange?.(pendingCount);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load applications.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [hubId, onPendingCountChange]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchApplications();
    });
  }, [fetchApplications]);

  const stats = useMemo(() => {
    let submitted = 0;
    let underReview = 0;
    let changesRequested = 0;
    let approved = 0;
    let rejected = 0;
    for (const app of applications) {
      if (app.status === 'submitted') submitted += 1;
      else if (app.status === 'under_review') underReview += 1;
      else if (app.status === 'changes_requested') changesRequested += 1;
      else if (app.status === 'approved') approved += 1;
      else if (app.status === 'rejected') rejected += 1;
    }
    return { submitted, underReview, changesRequested, approved, rejected };
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((app) => {
      if (statusFilter !== 'all' && app.status !== statusFilter) return false;
      if (trackFilter !== 'all' && app.application_type !== trackFilter)
        return false;
      if (!hubId && hubFilter !== 'all' && app.hub_id !== hubFilter)
        return false;
      if (!q) return true;
      const hubName = hubMap.get(app.hub_id)?.name || '';
      const haystack = [
        app.application_code,
        app.full_name,
        app.phone,
        app.whatsapp_number || '',
        app.locality || '',
        app.business_name || '',
        app.vehicle_reg_no || '',
        app.vehicle_type || '',
        app.organization_name || '',
        app.referral_code_used || '',
        hubName,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [applications, search, statusFilter, trackFilter, hubId, hubFilter, hubMap]);

  const handleOpenDetail = (app: PartnerApplicationRecord) => {
    setSelectedApp(app);
    setReviewerNotes(app.reviewer_notes || '');
    setActivePreview(null);
  };

  const handlePreviewKycDoc = async (
    app: PartnerApplicationRecord,
    doc: KycDocumentEntry
  ) => {
    setPreviewLoadingPath(doc.storage_path);
    setStatus('syncing', 'Generating secure 120s preview…');
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      let token = session?.access_token;
      if (!token) {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      }
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch('/api/onboarding/kyc-signed-url', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          applicationId: app.id,
          storagePath: doc.storage_path,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        signedUrl?: string;
        expiresInSeconds?: number;
        error?: string;
      };

      if (!res.ok || !payload.signedUrl) {
        const errText =
          payload.error || 'Could not generate private KYC preview link.';
        setStatus('error', errText);
        onNotice?.({ type: 'error', text: errText });
        return;
      }

      const isPdf = doc.storage_path.toLowerCase().endsWith('.pdf');
      setActivePreview({
        label: doc.label,
        storagePath: doc.storage_path,
        signedUrl: payload.signedUrl,
        expiresInSeconds: payload.expiresInSeconds ?? 120,
        isPdf,
      });
      setStatus('success', 'Private KYC preview ready (expires in 120s)');
    } catch {
      setStatus('error', 'Network error while fetching KYC preview.');
      onNotice?.({
        type: 'error',
        text: 'Network error while fetching KYC preview.',
      });
    } finally {
      setPreviewLoadingPath(null);
    }
  };

  const handleReviewAction = async (
    nextStatus: Exclude<PartnerApplicationStatus, 'submitted'>
  ) => {
    if (!selectedApp || isSubmittingReview) return;

    const cleanNotes = reviewerNotes.trim();
    if (
      (nextStatus === 'changes_requested' || nextStatus === 'rejected') &&
      cleanNotes.length < 4
    ) {
      const msg =
        nextStatus === 'changes_requested'
          ? 'Please enter specific reviewer feedback before requesting changes.'
          : 'Please enter a brief rejection reason before rejecting this application.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
      return;
    }

    const trackMeta = getTrackMeta(selectedApp.application_type);
    const confirmConfig: Record<
      typeof nextStatus,
      {
        title: string;
        description: string;
        confirmLabel: string;
        variant: 'default' | 'danger';
      }
    > = {
      under_review: {
        title: `Mark ${selectedApp.application_code} Under Review?`,
        description: `The applicant (${selectedApp.full_name}) will be notified that our team is actively verifying their ${trackMeta.label} documents and callback details.`,
        confirmLabel: 'Mark Under Review',
        variant: 'default',
      },
      changes_requested: {
        title: `Request Changes on ${selectedApp.application_code}?`,
        description: `The applicant will receive your feedback ("${cleanNotes}") and can re-upload corrected KYC documents right from /onboarding.`,
        confirmLabel: 'Request Changes',
        variant: 'default',
      },
      approved: {
        title: `Verify & Approve ${selectedApp.full_name}?`,
        description: `This immediately approves ${selectedApp.application_code} (${trackMeta.label}), provisions their operational workspace access, qualifies any linked referral, and schedules automatic 30-day KYC document purge.`,
        confirmLabel: 'Verify & Approve',
        variant: 'default',
      },
      rejected: {
        title: `Reject Application ${selectedApp.application_code}?`,
        description: `The applicant will be notified with your reason ("${cleanNotes}"), and uploaded KYC documents will be scheduled for automatic purge.`,
        confirmLabel: 'Reject Application',
        variant: 'danger',
      },
    };

    const cfg = confirmConfig[nextStatus];
    const ok = await confirmDialog({
      title: cfg.title,
      description: cfg.description,
      confirmLabel: cfg.confirmLabel,
      variant: cfg.variant,
    });
    if (!ok) return;

    setIsSubmittingReview(true);
    setStatus('saving', 'Updating application status…');
    try {
      const { error } = await supabase.rpc('review_partner_application', {
        p_application_id: selectedApp.id,
        p_new_status: nextStatus,
        p_reviewer_notes: cleanNotes || null,
      });

      if (error) {
        setStatus('error', error.message);
        onNotice?.({ type: 'error', text: error.message });
        return;
      }

      const successMsg =
        nextStatus === 'approved'
          ? `${selectedApp.application_code} approved! Partner role & onboarding notification dispatched.`
          : `${selectedApp.application_code} updated to ${getStatusBadge(nextStatus).label}.`;

      setStatus('success', successMsg);
      onNotice?.({ type: 'success', text: successMsg });
      setSelectedApp(null);
      setActivePreview(null);
      await fetchApplications();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to update application.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div
      data-testid="partner-applications-panel"
      className="space-y-4 min-w-0 max-w-full overflow-x-clip text-[var(--ps-text)]"
    >
      {/* Header + KPI Strip */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
              <h3 className="text-sm font-extrabold tracking-tight text-[var(--ps-text)] truncate">
                Partner, Driver &amp; Advertiser Applications
              </h3>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
              Manual KYC verification desk with private 120-second signed document previews and direct WhatsApp/Phone callback tools.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchApplications()}
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
            {
              label: 'New Submitted',
              value: stats.submitted,
              tone: 'text-[var(--ps-accent)]',
            },
            {
              label: 'Under Review',
              value: stats.underReview,
              tone: 'text-sky-600 dark:text-sky-400',
            },
            {
              label: 'Changes Req.',
              value: stats.changesRequested,
              tone: 'text-amber-700 dark:text-amber-300',
            },
            {
              label: 'Approved',
              value: stats.approved,
              tone: 'text-emerald-600 dark:text-emerald-400',
            },
            {
              label: 'Rejected',
              value: stats.rejected,
              tone: 'text-rose-600 dark:text-rose-400',
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
                className={`mt-0.5 text-lg font-extrabold tabular-nums ${stat.tone}`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3">
        <WorkspaceTableToolbar>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, applicant, phone, business, vehicle reg, referral…"
              data-testid="partner-apps-search-input"
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

        {/* Scrollable Status & Track Pill Strips */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 max-w-full">
            {STATUS_OPTIONS.map((opt) => {
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

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 max-w-full">
            {TRACK_OPTIONS.map((opt) => {
              const active = trackFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTrackFilter(opt.id)}
                  className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-sky-600 dark:border-sky-600'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {loadError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">{loadError}</span>
          </div>
        )}

        {/* Responsive Applications Table */}
        <ResponsiveTableScroll minWidthClass="min-w-[780px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)] bg-[var(--ps-bg)]/70">
                <th className="py-2.5 px-3 font-bold">Code &amp; Date</th>
                <th className="py-2.5 px-3 font-bold">Applicant &amp; Track</th>
                <th className="py-2.5 px-3 font-bold">Entity / Hub</th>
                <th className="py-2.5 px-3 font-bold">Callback &amp; Fee</th>
                <th className="py-2.5 px-3 font-bold">KYC</th>
                <th className="py-2.5 px-3 font-bold">Status</th>
                <th className="py-2.5 px-3 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-[var(--ps-text-muted)]"
                  >
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1.5" />
                    Loading partner applications…
                  </td>
                </tr>
              ) : filteredApplications.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-[var(--ps-text-muted)]"
                  >
                    No partner applications match the current filters.
                  </td>
                </tr>
              ) : (
                filteredApplications.map((app) => {
                  const trackMeta = getTrackMeta(app.application_type);
                  const TrackIcon = trackMeta.icon;
                  const statusMeta = getStatusBadge(app.status);
                  const hubName = hubMap.get(app.hub_id)?.name || 'Hub';
                  const entitySummary =
                    app.application_type === 'business_owner'
                      ? app.business_name || 'Business'
                      : app.application_type === 'driver'
                        ? `${app.vehicle_type || 'Vehicle'} ${app.vehicle_reg_no ? `(${app.vehicle_reg_no})` : ''}`
                        : app.organization_name || 'Advertiser';

                  return (
                    <tr
                      key={app.id}
                      data-testid={`partner-app-row-${app.application_code}`}
                      className="hover:bg-[var(--ps-surface-alt)]/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="font-mono font-bold text-[var(--ps-text)]">
                          {app.application_code || app.id.slice(0, 8)}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)] mt-0.5 tabular-nums">
                          {new Date(app.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top">
                        <div className="font-bold text-[var(--ps-text)]">
                          {app.full_name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${trackMeta.pillClass}`}
                          >
                            <TrackIcon className="w-2.5 h-2.5 shrink-0" />
                            {trackMeta.label}
                          </span>
                          {app.referral_code_used && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/12 text-violet-700 dark:text-violet-300 text-[10px] font-mono font-bold">
                              <Gift className="w-2.5 h-2.5" />
                              {app.referral_code_used}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[200px]">
                        <div className="font-semibold text-[var(--ps-text)] truncate">
                          {entitySummary}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)] flex items-center gap-1 mt-0.5 truncate">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {hubName}
                            {app.locality ? ` · ${app.locality}` : ''}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="font-mono text-[11px] text-[var(--ps-text)]">
                          {app.phone}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)] mt-0.5">
                          Pref:{' '}
                          <strong className="uppercase text-[var(--ps-text)]">
                            {app.preferred_contact}
                          </strong>{' '}
                          · ₹{app.registration_fee_inr}
                          {app.fee_acknowledged ? ' ✓' : ''}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold">
                          <Lock className="w-3 h-3 text-[var(--ps-accent)]" />
                          {app.kyc_documents.length} file
                          {app.kyc_documents.length === 1 ? '' : 's'}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusMeta.cls}`}
                        >
                          {statusMeta.label}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(app)}
                          data-testid={`review-partner-app-${app.application_code}`}
                          className="h-7 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[11px] font-bold inline-flex items-center gap-1 hover:opacity-95 cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </div>

      {/* Application Detail & Manual Verification Modal (z-[90]) */}
      {selectedApp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect application ${selectedApp.application_code}`}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-5"
          onClick={() => {
            if (!isSubmittingReview) {
              setSelectedApp(null);
              setActivePreview(null);
            }
          }}
        >
          <div
            className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-extrabold text-[var(--ps-accent)]">
                    {selectedApp.application_code}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${getStatusBadge(selectedApp.status).cls}`}
                  >
                    {getStatusBadge(selectedApp.status).label}
                  </span>
                </div>
                <h4 className="text-sm font-extrabold text-[var(--ps-text)] truncate mt-0.5">
                  {selectedApp.full_name} ·{' '}
                  {getTrackMeta(selectedApp.application_type).label}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedApp(null);
                  setActivePreview(null);
                }}
                aria-label="Close application modal"
                className="h-8 w-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Highlighted Preferred Callback Bar */}
              {(() => {
                const hubName =
                  hubMap.get(selectedApp.hub_id)?.name || 'DD oodle Hub';
                const trackLabel = getTrackMeta(
                  selectedApp.application_type
                ).label;
                const waTarget =
                  selectedApp.whatsapp_number || selectedApp.phone;
                const waHref = buildContextualWhatsAppUrl(waTarget, {
                  type: 'partner_callback',
                  hub: hubName,
                  applicationType: trackLabel,
                  applicationCode: selectedApp.application_code,
                  fullName: selectedApp.full_name,
                  note: reviewerNotes.trim() || undefined,
                });
                const prefersWhatsApp =
                  selectedApp.preferred_contact === 'whatsapp';

                return (
                  <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/8 p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div className="text-xs min-w-0">
                          <span className="font-bold text-[var(--ps-text)]">
                            Manual Verification Callback
                          </span>
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold uppercase">
                            Prefers {prefersWhatsApp ? 'WhatsApp' : 'Phone Call'}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-semibold text-[var(--ps-text)]">
                        {selectedApp.phone}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="partner-app-whatsapp-callback-btn"
                        className={`h-8 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-opacity hover:opacity-95 ${
                          prefersWhatsApp
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'border border-emerald-500/40 bg-[var(--ps-surface)] text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          WhatsApp Callback{' '}
                          {prefersWhatsApp ? '(Preferred)' : ''}
                        </span>
                      </a>

                      <a
                        href={`tel:${selectedApp.phone.replace(/\s+/g, '')}`}
                        data-testid="partner-app-phone-callback-btn"
                        className={`h-8 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-opacity hover:opacity-95 ${
                          !prefersWhatsApp
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                            : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
                        }`}
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Call Applicant {!prefersWhatsApp ? '(Preferred)' : ''}
                        </span>
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Structured Application Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Hub &amp; Locality
                  </p>
                  <p className="mt-1 font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                    <span>
                      {hubMap.get(selectedApp.hub_id)?.name || 'Service Hub'}
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                    {selectedApp.locality || 'No locality specified'}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Registration Fee Disclosure
                  </p>
                  <p className="mt-1 font-bold text-[var(--ps-text)] tabular-nums">
                    ₹{selectedApp.registration_fee_inr.toLocaleString('en-IN')}{' '}
                    {selectedApp.registration_fee_inr === 0
                      ? '(Free)'
                      : '(Payable after verification)'}
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5 font-semibold">
                    {selectedApp.fee_acknowledged
                      ? 'Fee & manual verification acknowledged'
                      : 'Not acknowledged'}
                  </p>
                </div>

                {selectedApp.application_type === 'business_owner' && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Business Details
                    </p>
                    <p className="mt-1 font-bold text-[var(--ps-text)]">
                      {selectedApp.business_name || '—'}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      Vertical: {selectedApp.business_vertical || 'General'}
                    </p>
                  </div>
                )}

                {selectedApp.application_type === 'driver' && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Vehicle Details
                    </p>
                    <p className="mt-1 font-bold text-[var(--ps-text)]">
                      {selectedApp.vehicle_type || '—'} ·{' '}
                      <span className="font-mono">
                        {selectedApp.vehicle_reg_no || 'No Reg No.'}
                      </span>
                    </p>
                  </div>
                )}

                {selectedApp.application_type === 'advertiser' && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Organization / Publisher
                    </p>
                    <p className="mt-1 font-bold text-[var(--ps-text)]">
                      {selectedApp.organization_name || '—'}
                    </p>
                  </div>
                )}

                {selectedApp.referral_code_used && (
                  <div className="rounded-xl border border-violet-500/25 bg-violet-500/8 p-3 sm:col-span-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                      <span className="font-semibold text-[var(--ps-text)]">
                        Referral Code Used:
                      </span>
                    </div>
                    <span className="font-mono font-extrabold text-violet-700 dark:text-violet-300">
                      {selectedApp.referral_code_used}
                    </span>
                  </div>
                )}

                {selectedApp.applicant_notes && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Applicant Notes
                    </p>
                    <p className="mt-1 text-xs text-[var(--ps-text)] whitespace-pre-wrap break-words">
                      {selectedApp.applicant_notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Private KYC Documents Section */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                    <span className="text-xs font-bold text-[var(--ps-text)]">
                      Private KYC Documents ({selectedApp.kyc_documents.length})
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)] inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    120s Signed URLs Only
                  </span>
                </div>

                {selectedApp.kyc_documents.length === 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    No KYC files attached to this application yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {selectedApp.kyc_documents.map((doc) => {
                      const isLoadingDoc =
                        previewLoadingPath === doc.storage_path;
                      return (
                        <div
                          key={doc.storage_path}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                                {doc.label}
                              </p>
                              <p className="text-[10px] text-[var(--ps-text-muted)] font-mono truncate">
                                {doc.doc_type}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={Boolean(previewLoadingPath)}
                            onClick={() =>
                              void handlePreviewKycDoc(selectedApp, doc)
                            }
                            data-testid={`preview-kyc-doc-${doc.doc_type}`}
                            className="h-7 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[11px] font-bold inline-flex items-center gap-1 hover:opacity-95 disabled:opacity-60 cursor-pointer shrink-0"
                          >
                            {isLoadingDoc ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Eye className="w-3 h-3" />
                            )}
                            <span>Secure Preview</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activePreview && (
                  <div className="mt-2 rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-surface)] p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        Preview: {activePreview.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <a
                          href={activePreview.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-7 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold text-[var(--ps-text)] inline-flex items-center gap-1 hover:bg-[var(--ps-surface-alt)]"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Open Tab</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => setActivePreview(null)}
                          className="h-7 px-2 rounded-lg text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                        >
                          Hide
                        </button>
                      </div>
                    </div>

                    {activePreview.isPdf ? (
                      <iframe
                        src={activePreview.signedUrl}
                        title={activePreview.label}
                        className="w-full h-72 rounded-lg border border-[var(--ps-border)] bg-white"
                      />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={activePreview.signedUrl}
                        alt={activePreview.label}
                        referrerPolicy="no-referrer"
                        className="w-full max-h-80 object-contain rounded-lg border border-[var(--ps-border)] bg-black/5"
                      />
                    )}
                    <p className="text-[10px] text-[var(--ps-text-muted)] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Temporary signed link auto-expires in{' '}
                      {activePreview.expiresInSeconds}s. KYC assets auto-purge 30 days after final decision.
                    </p>
                  </div>
                )}
              </div>

              {/* Reviewer Notes & Decision Actions */}
              <div className="space-y-2.5">
                <label
                  htmlFor="partner-reviewer-notes"
                  className="block text-xs font-bold text-[var(--ps-text)]"
                >
                  Reviewer Notes / Callback Feedback{' '}
                  <span className="font-normal text-[var(--ps-text-muted)]">
                    (Required for Request Changes or Reject)
                  </span>
                </label>
                <textarea
                  id="partner-reviewer-notes"
                  rows={3}
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="e.g., Called applicant on WhatsApp, Aadhaar and RC verified cleanly — approved for Churachandpur fleet."
                  className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSubmittingReview}
                    onClick={() => void handleReviewAction('approved')}
                    data-testid="partner-app-approve-btn"
                    className="h-9 px-3.5 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                  >
                    {isSubmittingReview ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>Verify &amp; Approve</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmittingReview}
                    onClick={() => void handleReviewAction('under_review')}
                    data-testid="partner-app-under-review-btn"
                    className="h-9 px-3 rounded-xl border border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-sky-500/20 disabled:opacity-60 cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Mark Under Review</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmittingReview}
                    onClick={() => void handleReviewAction('changes_requested')}
                    data-testid="partner-app-request-changes-btn"
                    className="h-9 px-3 rounded-xl border border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-amber-500/20 disabled:opacity-60 cursor-pointer"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Request Changes</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmittingReview}
                    onClick={() => void handleReviewAction('rejected')}
                    data-testid="partner-app-reject-btn"
                    className="h-9 px-3 rounded-xl border border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-rose-500/20 disabled:opacity-60 cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmModal}
    </div>
  );
}
