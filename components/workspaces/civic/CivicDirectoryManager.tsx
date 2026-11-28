'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Bell,
  Building2,
  Bus,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  FileCheck2,
  Flag,
  GraduationCap,
  HeartPulse,
  Landmark,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { CivicSummaryModal } from '@/components/verticals/civic/CivicSummaryModal';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { supabase } from '@/lib/supabase/client';
import type { Listing } from '@/lib/types';
import type {
  CivicCorrectionIssueType,
  CivicCorrectionReport,
  CivicDepartmentType,
  CivicDocumentChecklist,
  CivicHelpline,
  ListingCivicProfile,
  VerticalSummary,
} from '@/lib/verticals/types';

export interface CivicHubOption {
  id: string;
  name: string;
  slug: string;
  center_lat?: number;
  center_lng?: number;
}

export interface CivicDirectoryManagerProps {
  hubId?: string;
  hubs?: CivicHubOption[];
  isSuperAdmin?: boolean;
  onPendingReportsCountChange?: (count: number) => void;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

interface ManagedCivicListing {
  id: string;
  hub_id: string | null;
  title: string;
  category: string | null;
  subcategory: string | null;
  status: string | null;
  locality: string | null;
  address: string | null;
  short_description: string | null;
  description: string | null;
  contact_phone: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  coordinates?: { lat?: number; lng?: number } | null;
  cover_image?: string | null;
  listing_vertical?: string | null;
  is_civic_record?: boolean | null;
  vertical_summary?: VerticalSummary | null;
  created_at?: string | null;
  updated_at?: string | null;
  civic_profile: ListingCivicProfile | null;
}

interface HelplineDraft {
  label: string;
  phone: string;
  is_emergency: boolean;
  whatsapp: boolean;
}

interface ChecklistDraft {
  service_title: string;
  required_docs_text: string;
  fee_note: string;
  processing_time: string;
}

interface CivicFormState {
  listingId: string | null;
  hubId: string;
  title: string;
  departmentType: CivicDepartmentType;
  locality: string;
  address: string;
  lat: string;
  lng: string;
  is24x7: boolean;
  officeHoursText: string;
  officialWebsite: string;
  importantNotes: string;
  showNearbyPrintHelper: boolean;
  helplines: HelplineDraft[];
  checklists: ChecklistDraft[];
}

const DEPARTMENT_LABELS: Record<CivicDepartmentType, string> = {
  emergency_medical: 'Emergency & Medical',
  police_fire: 'Police & Fire',
  government_office: 'Government Office',
  utility_power_water: 'Utilities',
  public_transport_hub: 'Public Transport',
  community_religious: 'Community / Religious',
  education_public: 'Public Education',
};

const DEPARTMENT_BADGE_STYLES: Record<CivicDepartmentType, string> = {
  emergency_medical:
    'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  police_fire:
    'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  government_office:
    'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  utility_power_water:
    'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  public_transport_hub:
    'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  community_religious:
    'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  education_public:
    'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
};

const DEPARTMENT_ICONS: Record<CivicDepartmentType, typeof Landmark> = {
  emergency_medical: HeartPulse,
  police_fire: ShieldAlert,
  government_office: Landmark,
  utility_power_water: Zap,
  public_transport_hub: Bus,
  community_religious: Building2,
  education_public: GraduationCap,
};

const DEPARTMENT_FILTER_OPTIONS: CustomSelectOption[] = [
  { value: 'all', label: 'All Departments' },
  { value: 'emergency_medical', label: 'Emergency & Medical' },
  { value: 'police_fire', label: 'Police & Fire' },
  { value: 'government_office', label: 'Government Office' },
  { value: 'utility_power_water', label: 'Utilities' },
  { value: 'public_transport_hub', label: 'Public Transport' },
  { value: 'community_religious', label: 'Community / Religious' },
  { value: 'education_public', label: 'Public Education' },
];

const DEPARTMENT_EDIT_OPTIONS: CustomSelectOption[] =
  DEPARTMENT_FILTER_OPTIONS.filter((o) => o.value !== 'all');

const ISSUE_TYPE_LABELS: Record<CivicCorrectionIssueType, string> = {
  wrong_phone: 'Wrong Phone',
  wrong_hours: 'Wrong Hours',
  outdated_checklist: 'Outdated Checklist',
  wrong_location: 'Wrong Location',
  closed_relocated: 'Closed/Relocated',
  other: 'Other',
};

const ALERT_EXPIRY_PRESETS: Array<{ label: string; hours: number }> = [
  { label: '4 Hours', hours: 4 },
  { label: '24 Hours', hours: 24 },
  { label: '3 Days', hours: 72 },
  { label: '7 Days', hours: 168 },
];

function isAlertCurrentlyActive(
  alertText: string | null | undefined,
  expiresAt: string | null | undefined,
  nowMs: number
): boolean {
  if (!alertText || !alertText.trim()) return false;
  if (!expiresAt) return true;
  const parsed = new Date(expiresAt).getTime();
  if (Number.isNaN(parsed)) return true;
  return parsed > nowMs;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildPreviewListing(row: ManagedCivicListing): Listing {
  const lat = Number(row.lat ?? row.coordinates?.lat ?? 24.3333);
  const lng = Number(row.lng ?? row.coordinates?.lng ?? 93.6833);
  const primaryPhone =
    row.civic_profile?.helplines?.[0]?.phone ||
    row.contact_phone ||
    row.phone ||
    '';

  return {
    id: row.id,
    hub_id: row.hub_id || null,
    title: row.title,
    category: 'public_place',
    subcategory: row.subcategory || 'Public & Govt Services',
    shortDescription: row.short_description || row.address || row.title,
    description: row.description || row.short_description || row.title,
    locality: row.locality || 'Central Hub',
    address: row.address || row.locality || '',
    coordinates: {
      lat: Number.isFinite(lat) ? lat : 24.3333,
      lng: Number.isFinite(lng) ? lng : 93.6833,
    },
    status: (row.status as Listing['status']) || 'published',
    verificationStatus: 'verified_demo',
    ownerId: 'civic-directory',
    ownerName: 'DD oodle Civic Directory',
    assignedStaffIds: [],
    contactPhone: primaryPhone,
    contactEmail: '',
    coverImage: row.cover_image || '',
    galleryImages: [],
    rating: 0,
    reviewCount: 0,
    viewsCount: 0,
    mapImpressionsCount: 0,
    detailVisitsCount: 0,
    followsCount: 0,
    enquiriesCount: 0,
    directionClicksCount: 0,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    versionHistory: [],
    listing_vertical: 'public_civic',
    is_civic_record: true,
    vertical_summary: row.vertical_summary || {
      department_type: row.civic_profile?.department_type || 'government_office',
      is_24x7: Boolean(row.civic_profile?.is_24x7),
      primary_phone: primaryPhone || null,
      helpline_count: row.civic_profile?.helplines?.length || 0,
      checklist_count: row.civic_profile?.document_checklists?.length || 0,
    },
  };
}

export function CivicDirectoryManager({
  hubId,
  hubs = [],
  isSuperAdmin = false,
  onPendingReportsCountChange,
  onNotice,
}: CivicDirectoryManagerProps) {
  const isHydrated = useHydrated();
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();
  const canSwitchHubs = Boolean(isSuperAdmin && hubs.length > 0);
  const [selectedHubFilter, setSelectedHubFilter] = useState<string>(() =>
    canSwitchHubs ? hubId || 'all' : hubId || hubs[0]?.id || ''
  );

  const effectiveHubQuery = useMemo(() => {
    if (canSwitchHubs) {
      return selectedHubFilter || 'all';
    }
    return hubId || selectedHubFilter || hubs[0]?.id || '';
  }, [canSwitchHubs, selectedHubFilter, hubId, hubs]);

  const hubMap = useMemo(() => {
    const map = new Map<string, CivicHubOption>();
    for (const h of hubs) {
      map.set(h.id, h);
    }
    return map;
  }, [hubs]);

  const [activeSubTab, setActiveSubTab] = useState<'directory' | 'corrections'>(
    'directory'
  );
  const [civicListings, setCivicListings] = useState<ManagedCivicListing[]>([]);
  const [correctionReports, setCorrectionReports] = useState<
    CivicCorrectionReport[]
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
  }, []);

  // Sub-Tab 1 filters
  const [dirSearch, setDirSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [only24x7, setOnly24x7] = useState(false);

  // Sub-Tab 2 filters
  const [reportSearch, setReportSearch] = useState('');
  const [reportStatusFilter, setReportStatusFilter] = useState<
    'pending' | 'approved' | 'rejected' | 'all'
  >('pending');

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [formState, setFormState] = useState<CivicFormState | null>(null);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [alertTarget, setAlertTarget] = useState<ManagedCivicListing | null>(
    null
  );
  const [alertTextDraft, setAlertTextDraft] = useState('');
  const [alertExpiryHours, setAlertExpiryHours] = useState<number>(24);
  const [isSavingAlert, setIsSavingAlert] = useState(false);

  const [reviewTarget, setReviewTarget] = useState<{
    report: CivicCorrectionReport;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const [reviewerNoteDraft, setReviewerNoteDraft] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const [previewTarget, setPreviewTarget] =
    useState<ManagedCivicListing | null>(null);

  const getAuthHeaders = useCallback(async (): Promise<
    Record<string, string>
  > => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch {
      // Cookie session fallback handled server-side
    }
    return headers;
  }, []);

  const loadCivicData = useCallback(async () => {
    if (!effectiveHubQuery) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/civic/manage?hubId=${encodeURIComponent(effectiveHubQuery)}`,
        {
          method: 'GET',
          headers,
          cache: 'no-store',
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || 'Failed to load civic directory records.'
        );
      }

      const nextListings = Array.isArray(data.civic_listings)
        ? (data.civic_listings as ManagedCivicListing[])
        : [];
      const nextReports = Array.isArray(data.correction_reports)
        ? (data.correction_reports as CivicCorrectionReport[])
        : [];

      setCivicListings(nextListings);
      setCorrectionReports(nextReports);
      setNowMs(Date.now());
      onPendingReportsCountChange?.(
        nextReports.filter((r) => r.status === 'pending').length
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to load civic governance data.';
      setLoadError(msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  }, [effectiveHubQuery, getAuthHeaders, onPendingReportsCountChange, onNotice]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadCivicData();
      }
    });
    return () => {
      active = false;
    };
  }, [loadCivicData]);

  const pendingReportsCount = useMemo(
    () => correctionReports.filter((r) => r.status === 'pending').length,
    [correctionReports]
  );

  const hubFilterOptions = useMemo<CustomSelectOption[]>(() => {
    return [
      { value: 'all', label: 'All Hubs', description: 'View all regional hubs' },
      ...hubs.map((h) => ({
        value: h.id,
        label: h.name,
        description: h.slug,
      })),
    ];
  }, [hubs]);

  const hubSelectOptionsForCreate = useMemo<CustomSelectOption[]>(() => {
    return hubs.map((h) => ({
      value: h.id,
      label: h.name,
      description: h.slug,
    }));
  }, [hubs]);

  // Filtered Directory Rows
  const filteredListings = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    return civicListings.filter((item) => {
      const profile = item.civic_profile;
      const dept =
        profile?.department_type ||
        (item.vertical_summary?.department_type as CivicDepartmentType) ||
        'government_office';

      if (deptFilter !== 'all' && dept !== deptFilter) return false;
      if (only24x7 && !profile?.is_24x7) return false;

      if (q) {
        const helplinesStr = (profile?.helplines || [])
          .map((h) => `${h.label} ${h.phone}`)
          .join(' ')
          .toLowerCase();
        const hay = `${item.title} ${item.locality || ''} ${item.address || ''} ${
          item.contact_phone || ''
        } ${helplinesStr}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [civicListings, dirSearch, deptFilter, only24x7]);

  const hasActiveDirFilters =
    dirSearch.trim().length > 0 || deptFilter !== 'all' || only24x7;

  // Filtered Correction Reports
  const filteredReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return correctionReports.filter((rep) => {
      if (reportStatusFilter !== 'all' && rep.status !== reportStatusFilter) {
        return false;
      }
      if (q) {
        const hay = `${rep.listing_title || ''} ${rep.suggested_correction} ${
          rep.reporter_contact || ''
        } ${ISSUE_TYPE_LABELS[rep.issue_type] || rep.issue_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [correctionReports, reportSearch, reportStatusFilter]);

  const hasActiveReportFilters =
    reportSearch.trim().length > 0 || reportStatusFilter !== 'pending';

  // Open Add Modal
  const handleOpenAddModal = () => {
    const defaultHubId =
      effectiveHubQuery && effectiveHubQuery !== 'all'
        ? effectiveHubQuery
        : hubs[0]?.id || '';
    const targetHub = hubMap.get(defaultHubId) || hubs[0];

    setFormError(null);
    setFormState({
      listingId: null,
      hubId: defaultHubId,
      title: '',
      departmentType: 'government_office',
      locality: '',
      address: '',
      lat:
        targetHub?.center_lat !== undefined
          ? String(targetHub.center_lat)
          : '24.3333',
      lng:
        targetHub?.center_lng !== undefined
          ? String(targetHub.center_lng)
          : '93.6833',
      is24x7: false,
      officeHoursText: 'Mon–Fri, 10:00 AM – 4:30 PM',
      officialWebsite: '',
      importantNotes: '',
      showNearbyPrintHelper: true,
      helplines: [
        { label: 'Main Citizen Desk', phone: '', is_emergency: false, whatsapp: false },
      ],
      checklists: [],
    });
    setIsEditModalOpen(true);
  };

  // Open Edit Modal for existing civic record
  const handleOpenEditModal = useCallback(
    (row: ManagedCivicListing) => {
      const profile = row.civic_profile;
      const resolvedHubId = row.hub_id || hubId || hubs[0]?.id || '';
      const hubObj = hubMap.get(resolvedHubId);

      const latVal =
        row.lat ?? row.coordinates?.lat ?? hubObj?.center_lat ?? 24.3333;
      const lngVal =
        row.lng ?? row.coordinates?.lng ?? hubObj?.center_lng ?? 93.6833;

      const helplinesDraft: HelplineDraft[] =
        Array.isArray(profile?.helplines) && profile.helplines.length > 0
          ? profile.helplines.map((h) => ({
              label: h.label || '',
              phone: h.phone || '',
              is_emergency: Boolean(h.is_emergency),
              whatsapp: Boolean(h.whatsapp),
            }))
          : row.contact_phone
            ? [
                {
                  label: 'Primary Helpline',
                  phone: row.contact_phone,
                  is_emergency: false,
                  whatsapp: false,
                },
              ]
            : [];

      const checklistsDraft: ChecklistDraft[] = Array.isArray(
        profile?.document_checklists
      )
        ? profile.document_checklists.map((c) => ({
            service_title: c.service_title || '',
            required_docs_text: Array.isArray(c.required_docs)
              ? c.required_docs.join('\n')
              : '',
            fee_note: c.fee_note || '',
            processing_time: c.processing_time || '',
          }))
        : [];

      setFormError(null);
      setFormState({
        listingId: row.id,
        hubId: resolvedHubId,
        title: row.title || '',
        departmentType: profile?.department_type || 'government_office',
        locality: row.locality || '',
        address: row.address || '',
        lat: String(latVal),
        lng: String(lngVal),
        is24x7: Boolean(profile?.is_24x7),
        officeHoursText: profile?.office_hours_text || '',
        officialWebsite: profile?.official_website || '',
        importantNotes: profile?.important_notes || '',
        showNearbyPrintHelper:
          profile?.show_nearby_print_helper !== undefined
            ? Boolean(profile.show_nearby_print_helper)
            : true,
        helplines: helplinesDraft,
        checklists: checklistsDraft,
      });
      setIsEditModalOpen(true);
    },
    [hubId, hubs, hubMap]
  );

  // Submit Add / Edit Civic Record
  const handleSaveCivicRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState) return;
    setFormError(null);

    if (!formState.hubId) {
      setFormError('Please select a target hub for this civic office.');
      return;
    }
    if (formState.title.trim().length < 3) {
      setFormError('Office title must be at least 3 characters.');
      return;
    }

    const helplinesPayload: CivicHelpline[] = formState.helplines
      .map((h) => ({
        label: h.label.trim(),
        phone: h.phone.trim(),
        is_emergency: h.is_emergency,
        whatsapp: h.whatsapp,
      }))
      .filter((h) => h.label && h.phone);

    const checklistsPayload: CivicDocumentChecklist[] = formState.checklists
      .map((c) => ({
        service_title: c.service_title.trim(),
        required_docs: c.required_docs_text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        fee_note: c.fee_note.trim() || null,
        processing_time: c.processing_time.trim() || null,
      }))
      .filter((c) => c.service_title);

    const ok = await confirm({
      title: formState.listingId
        ? 'Save Official Civic Record Changes?'
        : 'Publish Official Civic Office?',
      description: `Save "${formState.title.trim()}" (${formState.locality.trim() || 'Central Hub'}) with ${helplinesPayload.length} helpline(s) and ${checklistsPayload.length} checklist(s)?`,
      impactSummary: [
        `Office: ${formState.title.trim()}`,
        `Helplines: ${helplinesPayload.length} · Checklists: ${checklistsPayload.length}`,
      ],
      confirmLabel: formState.listingId ? 'Save Changes' : 'Create Civic Record',
      variant: 'info',
    });
    if (!ok) return;

    setIsSavingRecord(true);
    setAppStatus('saving', 'Saving official civic record…');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/civic/manage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'upsert_civic_listing',
          listingId: formState.listingId,
          hubId: formState.hubId,
          title: formState.title.trim(),
          departmentType: formState.departmentType,
          locality: formState.locality.trim(),
          address: formState.address.trim(),
          lat: Number(formState.lat),
          lng: Number(formState.lng),
          is24x7: formState.is24x7,
          officeHoursText: formState.officeHoursText.trim() || null,
          officialWebsite: formState.officialWebsite.trim() || null,
          importantNotes: formState.importantNotes.trim() || null,
          showNearbyPrintHelper: formState.showNearbyPrintHelper,
          helplines: helplinesPayload,
          documentChecklists: checklistsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save civic office.');
      }

      const msg = formState.listingId
        ? `Updated civic office "${formState.title.trim()}".`
        : `Created civic office "${formState.title.trim()}".`;
      setAppStatus('success', msg);
      onNotice?.({ type: 'success', text: msg });
      setIsEditModalOpen(false);
      setFormState(null);
      await loadCivicData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to save civic office.';
      setFormError(msg);
      setAppStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsSavingRecord(false);
    }
  };

  // Open Quick Live Alert Modal
  const handleOpenAlertModal = (row: ManagedCivicListing) => {
    setAlertTarget(row);
    setAlertTextDraft(row.civic_profile?.live_civic_alert || '');
    setAlertExpiryHours(24);
  };

  // Submit Live Civic Alert update or clear
  const handleSubmitLiveAlert = async (clearAlert: boolean) => {
    if (!alertTarget) return;
    if (!clearAlert && !alertTextDraft.trim()) {
      setAppStatus('error', 'Enter an alert message or click Clear Active Alert.');
      return;
    }

    const ok = await confirm({
      title: clearAlert
        ? 'Clear Active Civic Alert?'
        : 'Publish Live Civic Alert?',
      description: clearAlert
        ? `Remove the live notice from "${alertTarget.title}"?`
        : `Pin live notice on "${alertTarget.title}" for ${alertExpiryHours} hours?`,
      caution: clearAlert
        ? 'Citizens will no longer see the active notice banner on this office.'
        : 'Pinned alerts display immediately at the top of the public civic office card.',
      impactSummary: [
        `Office: ${alertTarget.title}`,
        clearAlert ? 'Action: Clear banner' : `Duration: ${alertExpiryHours}h`,
      ],
      confirmLabel: clearAlert ? 'Clear Alert' : 'Publish Alert',
      variant: clearAlert ? 'danger' : 'warning',
    });
    if (!ok) return;

    setIsSavingAlert(true);
    setAppStatus(
      'saving',
      clearAlert ? 'Clearing civic alert…' : 'Publishing live civic alert…'
    );
    try {
      const headers = await getAuthHeaders();
      const expiresAt = clearAlert
        ? null
        : new Date(Date.now() + alertExpiryHours * 3600 * 1000).toISOString();

      const res = await fetch('/api/civic/manage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'update_live_alert',
          listingId: alertTarget.id,
          liveCivicAlert: clearAlert ? null : alertTextDraft.trim(),
          liveCivicAlertExpiresAt: expiresAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update live civic alert.');
      }

      const msg = clearAlert
        ? `Cleared live alert for ${alertTarget.title}.`
        : `Pinned live alert for ${alertTarget.title}.`;
      setAppStatus('success', msg);
      onNotice?.({ type: 'success', text: msg });
      setAlertTarget(null);
      await loadCivicData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to update live alert.';
      setAppStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsSavingAlert(false);
    }
  };

  // Submit Correction Review
  const handleSubmitCorrectionReview = async () => {
    if (!reviewTarget) return;
    if (
      reviewTarget.decision === 'rejected' &&
      reviewerNoteDraft.trim().length < 4
    ) {
      const msg =
        'Please enter a reviewer reason note (at least 4 characters) before rejecting this citizen report.';
      setAppStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
      return;
    }

    const ok = await confirm({
      title:
        reviewTarget.decision === 'approved'
          ? 'Approve Citizen Correction Report?'
          : 'Reject Citizen Correction Report?',
      description: `${
        reviewTarget.decision === 'approved' ? 'Approve' : 'Reject'
      } this report for "${
        reviewTarget.report.listing_title || 'civic office'
      }"?`,
      caution:
        reviewTarget.decision === 'rejected'
          ? 'This closes the citizen report as rejected with your reviewer note.'
          : undefined,
      impactSummary: [
        `Office: ${reviewTarget.report.listing_title || 'Civic Office'}`,
        `Issue: ${ISSUE_TYPE_LABELS[reviewTarget.report.issue_type] || reviewTarget.report.issue_type}`,
        ...(reviewerNoteDraft.trim()
          ? [`Note: ${reviewerNoteDraft.trim()}`]
          : []),
      ],
      confirmLabel:
        reviewTarget.decision === 'approved'
          ? 'Approve Correction'
          : 'Reject Report',
      variant: reviewTarget.decision === 'approved' ? 'info' : 'danger',
    });
    if (!ok) return;
    setIsSubmittingReview(true);
    setAppStatus(
      'saving',
      reviewTarget.decision === 'approved'
        ? 'Approving correction report…'
        : 'Rejecting correction report…'
    );
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/civic/manage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'review_correction',
          reportId: reviewTarget.report.id,
          decision: reviewTarget.decision,
          reviewerNote: reviewerNoteDraft.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to review correction report.');
      }

      const msg =
        reviewTarget.decision === 'approved'
          ? `Approved correction for ${reviewTarget.report.listing_title || 'civic office'}.`
          : `Rejected correction for ${reviewTarget.report.listing_title || 'civic office'}.`;
      setAppStatus('success', msg);
      onNotice?.({ type: 'success', text: msg });
      setReviewTarget(null);
      setReviewerNoteDraft('');
      await loadCivicData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to submit review.';
      setAppStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleOpenOfficeFromReport = (listingId: string) => {
    const match = civicListings.find((item) => item.id === listingId);
    if (!match) {
      setAppStatus(
        'error',
        'Office record not found in current hub view. Switch to All Hubs or refresh.'
      );
      return;
    }
    handleOpenEditModal(match);
  };

  return (
    <div
      data-testid="civic-directory-manager"
      className="space-y-3.5 min-w-0 max-w-full overflow-x-clip"
    >
      {/* Header & Sub-Tab Controls */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-white dark:bg-slate-700">
              <Landmark className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-sm font-extrabold tracking-tight text-[var(--ps-text)]">
                  Public &amp; Civic Services Desk
                </h2>
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-300/80 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  Official Info Only
                </span>
              </div>
              <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                Manage official government offices, emergency helplines,
                required document checklists, live notices &amp; citizen
                corrections.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canSwitchHubs && (
              <div className="w-44">
                <CustomSelectModal
                  options={hubFilterOptions}
                  value={selectedHubFilter}
                  onChange={(val) => setSelectedHubFilter(val)}
                  placeholder="Filter by Hub"
                  testId="civic-hub-filter-select"
                  className="[&_button]:min-h-[32px] [&_button]:h-8 [&_button]:py-1 [&_button]:px-2.5 [&_button]:rounded-lg"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => void loadCivicData()}
              disabled={isLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
          <button
            type="button"
            data-testid="civic-subtab-directory"
            onClick={() => setActiveSubTab('directory')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'directory'
                ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-slate-200 dark:border-slate-800 hover:text-[var(--ps-text)]'
            }`}
          >
            <Landmark className="h-3.5 w-3.5" />
            <span>Civic Directory</span>
            <span
              className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold tabular-nums ${
                activeSubTab === 'directory'
                  ? 'bg-white/20 text-theme-primary-foreground'
                  : 'bg-slate-200 dark:bg-slate-800 text-[var(--ps-text)]'
              }`}
            >
              {civicListings.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="civic-subtab-corrections"
            onClick={() => setActiveSubTab('corrections')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'corrections'
                ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-slate-200 dark:border-slate-800 hover:text-[var(--ps-text)]'
            }`}
          >
            <Flag className="h-3.5 w-3.5" />
            <span>Corrections Queue</span>
            <span
              className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold tabular-nums ${
                pendingReportsCount > 0
                  ? activeSubTab === 'corrections'
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                  : activeSubTab === 'corrections'
                    ? 'bg-white/20 text-theme-primary-foreground'
                    : 'bg-slate-200 dark:bg-slate-800 text-[var(--ps-text)]'
              }`}
            >
              {pendingReportsCount} pending
            </span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadCivicData()}
            className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] font-bold hover:bg-rose-500/10 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 1: OFFICIAL PUBLIC & GOVT DIRECTORY
          ===================================================================== */}
      {activeSubTab === 'directory' && (
        <div className="space-y-3 min-w-0 max-w-full">
          <WorkspaceTableToolbar
            searchQuery={dirSearch}
            onSearchChange={setDirSearch}
            searchPlaceholder="Search office, locality, or helpline…"
            filteredCount={filteredListings.length}
            totalCount={civicListings.length}
            countLabel="offices"
            hasActiveFilters={hasActiveDirFilters}
            onResetFilters={() => {
              setDirSearch('');
              setDeptFilter('all');
              setOnly24x7(false);
            }}
            actions={
              <button
                type="button"
                data-testid="civic-add-office-btn"
                onClick={handleOpenAddModal}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 transition-opacity cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Civic Office</span>
              </button>
            }
          >
            <div className="w-44">
              <CustomSelectModal
                options={DEPARTMENT_FILTER_OPTIONS}
                value={deptFilter}
                onChange={setDeptFilter}
                placeholder="Department"
                testId="civic-department-filter"
                className="[&_button]:min-h-[32px] [&_button]:h-8 [&_button]:py-1 [&_button]:px-2.5 [&_button]:rounded-lg"
              />
            </div>

            <button
              type="button"
              onClick={() => setOnly24x7((prev) => !prev)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                only24x7
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>24×7 Only</span>
            </button>
          </WorkspaceTableToolbar>

          <ResponsiveTableScroll minWidthClass="min-w-[860px]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/60 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2.5">Office Name &amp; Locality</th>
                  <th className="px-3 py-2.5">Department</th>
                  <th className="px-3 py-2.5">Primary Helpline</th>
                  <th className="px-3 py-2.5">Checklists</th>
                  <th className="px-3 py-2.5">Live Alert</th>
                  <th className="px-3 py-2.5">Last Verified</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, idx) => (
                    <tr key={`civic-skel-${idx}`}>
                      <td colSpan={7} className="px-3 py-3">
                        <div className="dd-shimmer h-10 rounded-xl" />
                      </td>
                    </tr>
                  ))
                ) : filteredListings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-xs text-[var(--ps-text-muted)]"
                    >
                      {hasActiveDirFilters
                        ? 'No civic offices match your current search or filters.'
                        : 'No official civic records found in this hub yet. Click "+ Add Civic Office" to create one.'}
                    </td>
                  </tr>
                ) : (
                  filteredListings.map((row) => {
                    const profile = row.civic_profile;
                    const dept: CivicDepartmentType =
                      profile?.department_type || 'government_office';
                    const DeptIcon = DEPARTMENT_ICONS[dept] || Landmark;
                    const helplines = Array.isArray(profile?.helplines)
                      ? profile.helplines
                      : [];
                    const primaryHelpline =
                      helplines.find((h) => h.is_emergency) || helplines[0];
                    const extraHelplines = Math.max(0, helplines.length - 1);
                    const checklistCount = Array.isArray(
                      profile?.document_checklists
                    )
                      ? profile.document_checklists.length
                      : 0;
                    const alertActive = isAlertCurrentlyActive(
                      profile?.live_civic_alert,
                      profile?.live_civic_alert_expires_at,
                      nowMs
                    );
                    const hubLabel = row.hub_id
                      ? hubMap.get(row.hub_id)?.name
                      : null;

                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-bold text-[var(--ps-text)] leading-snug">
                            {row.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
                            <span className="inline-flex items-center gap-0.5">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {row.locality || 'Central Area'}
                            </span>
                            {hubLabel && effectiveHubQuery === 'all' && (
                              <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                {hubLabel}
                              </span>
                            )}
                            {profile?.is_24x7 && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                24×7
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5 align-top">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                              DEPARTMENT_BADGE_STYLES[dept]
                            }`}
                          >
                            <DeptIcon className="h-3 w-3 shrink-0" />
                            <span>{DEPARTMENT_LABELS[dept]}</span>
                          </span>
                        </td>

                        <td className="px-3 py-2.5 align-top">
                          {primaryHelpline ? (
                            <div className="space-y-0.5">
                              <div className="inline-flex items-center gap-1 font-semibold text-[var(--ps-text)] tabular-nums">
                                <Phone className="h-3 w-3 text-slate-400" />
                                <span>{primaryHelpline.phone}</span>
                                {extraHelplines > 0 && (
                                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                    +{extraHelplines} more
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-[var(--ps-text-muted)]">
                                {primaryHelpline.label}
                              </div>
                            </div>
                          ) : row.contact_phone ? (
                            <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                              {row.contact_phone}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              None added
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top">
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                            <FileCheck2 className="h-3 w-3 text-slate-500" />
                            {checklistCount}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 align-top">
                          {alertActive ? (
                            <div className="space-y-0.5 max-w-[180px]">
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                                <Bell className="h-3 w-3" />
                                Active
                              </span>
                              <p className="truncate text-[10px] text-[var(--ps-text-muted)]">
                                {profile?.live_civic_alert}
                              </p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800/70 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                              None
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top whitespace-nowrap text-[11px] text-[var(--ps-text-muted)]">
                          {formatShortDate(
                            profile?.last_verified_at || row.updated_at
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(row)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenAlertModal(row)}
                              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                                alertActive
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20'
                                  : 'border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                              }`}
                            >
                              <Bell className="h-3 w-3" />
                              <span>Live Alert</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setPreviewTarget(row)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-theme-primary hover:bg-theme-primary/10 transition-colors cursor-pointer"
                              title="Preview citizen Civic Summary Modal"
                            >
                              <Eye className="h-3 w-3" />
                              <span>Preview</span>
                            </button>
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
      )}

      {/* =====================================================================
          SUB-TAB 2: CROWDSOURCED CORRECTIONS QUEUE
          ===================================================================== */}
      {activeSubTab === 'corrections' && (
        <div className="space-y-3 min-w-0 max-w-full">
          <WorkspaceTableToolbar
            searchQuery={reportSearch}
            onSearchChange={setReportSearch}
            searchPlaceholder="Search office title or suggested correction…"
            filteredCount={filteredReports.length}
            totalCount={correctionReports.length}
            countLabel="reports"
            hasActiveFilters={hasActiveReportFilters}
            onResetFilters={() => {
              setReportSearch('');
              setReportStatusFilter('pending');
            }}
          >
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'pending', label: 'Pending' },
                  { id: 'approved', label: 'Approved' },
                  { id: 'rejected', label: 'Rejected' },
                  { id: 'all', label: 'All' },
                ] as const
              ).map((pill) => {
                const active = reportStatusFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setReportStatusFilter(pill.id)}
                    className={`inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'bg-theme-primary text-theme-primary-foreground'
                        : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
                    }`}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
          </WorkspaceTableToolbar>

          <ResponsiveTableScroll minWidthClass="min-w-[900px]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/60 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2.5">Target Office</th>
                  <th className="px-3 py-2.5">Issue Type</th>
                  <th className="px-3 py-2.5">Suggested Correction</th>
                  <th className="px-3 py-2.5">Reporter Contact</th>
                  <th className="px-3 py-2.5">Submitted</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, idx) => (
                    <tr key={`report-skel-${idx}`}>
                      <td colSpan={7} className="px-3 py-3">
                        <div className="dd-shimmer h-10 rounded-xl" />
                      </td>
                    </tr>
                  ))
                ) : filteredReports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-xs text-[var(--ps-text-muted)]"
                    >
                      No correction reports match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredReports.map((rep) => {
                    const isPending = rep.status === 'pending';
                    const hubLabel = rep.hub_id
                      ? hubMap.get(rep.hub_id)?.name
                      : null;
                    return (
                      <tr
                        key={rep.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-bold text-[var(--ps-text)]">
                            {rep.listing_title ||
                              `Office ${rep.listing_id.slice(0, 8)}`}
                          </div>
                          {hubLabel && effectiveHubQuery === 'all' && (
                            <span className="mt-0.5 inline-block rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                              {hubLabel}
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md border border-slate-300/80 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                            {ISSUE_TYPE_LABELS[rep.issue_type] ||
                              rep.issue_type}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 align-top max-w-[300px]">
                          <p className="text-xs text-[var(--ps-text)] whitespace-pre-wrap break-words leading-relaxed">
                            {rep.suggested_correction}
                          </p>
                          {rep.reviewer_note && (
                            <p className="mt-1 text-[10px] italic text-[var(--ps-text-muted)]">
                              Reviewer note: {rep.reviewer_note}
                            </p>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-top text-[11px] text-[var(--ps-text-muted)]">
                          {rep.reporter_contact || 'Anonymous'}
                        </td>

                        <td className="px-3 py-2.5 align-top whitespace-nowrap text-[11px] text-[var(--ps-text-muted)]">
                          {formatDateTime(rep.created_at)}
                        </td>

                        <td className="px-3 py-2.5 align-top whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                              rep.status === 'pending'
                                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                : rep.status === 'approved'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {rep.status}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 align-top">
                          {isPending ? (
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenOfficeFromReport(rep.listing_id)
                                }
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                              >
                                <Edit3 className="h-3 w-3" />
                                <span>Open &amp; Edit Office</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setReviewerNoteDraft('');
                                  setReviewTarget({
                                    report: rep,
                                    decision: 'approved',
                                  });
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[11px] font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Approve</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setReviewerNoteDraft('');
                                  setReviewTarget({
                                    report: rep,
                                    decision: 'rejected',
                                  });
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                              >
                                <XCircle className="h-3 w-3" />
                                <span>Reject</span>
                              </button>
                            </div>
                          ) : (
                            <div className="text-right text-[10px] text-[var(--ps-text-muted)]">
                              Reviewed {formatShortDate(rep.reviewed_at)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: ADD / EDIT CIVIC RECORD MODAL (PORTALED AT z-[90])
          ===================================================================== */}
      {isHydrated &&
        createPortal(
          <AnimatePresence>
            {isEditModalOpen && formState && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!isSavingRecord) setIsEditModalOpen(false);
                }}
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4"
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label={
                    formState.listingId
                      ? 'Edit Civic Office'
                      : 'Add Civic Office'
                  }
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ duration: 0.18 }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
                >
                  {/* Modal Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-theme-primary" />
                      <h3 className="text-sm font-extrabold">
                        {formState.listingId
                          ? 'Edit Official Civic Office'
                          : 'Add Official Civic Office'}
                      </h3>
                    </div>
                    <button
                      type="button"
                      disabled={isSavingRecord}
                      onClick={() => setIsEditModalOpen(false)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Scrollable Form Body */}
                  <form
                    onSubmit={handleSaveCivicRecord}
                    className="flex flex-1 flex-col overflow-hidden"
                  >
                    <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4">
                      {formError && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                          {formError}
                        </div>
                      )}

                      {/* Core Details Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Official Office / Facility Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={formState.title}
                            onChange={(e) =>
                              setFormState((prev) =>
                                prev ? { ...prev, title: e.target.value } : prev
                              )
                            }
                            placeholder="e.g. District Hospital Churachandpur"
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                          />
                        </div>

                        {canSwitchHubs && (
                          <div>
                            <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                              Service Hub *
                            </label>
                            <CustomSelectModal
                              options={hubSelectOptionsForCreate}
                              value={formState.hubId}
                              onChange={(val) => {
                                const chosen = hubMap.get(val);
                                setFormState((prev) => {
                                  if (!prev) return prev;
                                  const isNew = !prev.listingId;
                                  return {
                                    ...prev,
                                    hubId: val,
                                    lat:
                                      isNew && chosen?.center_lat !== undefined
                                        ? String(chosen.center_lat)
                                        : prev.lat,
                                    lng:
                                      isNew && chosen?.center_lng !== undefined
                                        ? String(chosen.center_lng)
                                        : prev.lng,
                                  };
                                });
                              }}
                              placeholder="Select Hub"
                              testId="civic-form-hub-select"
                              className="[&_button]:min-h-[36px] [&_button]:h-9 [&_button]:py-1.5 [&_button]:px-3 [&_button]:rounded-lg"
                            />
                          </div>
                        )}

                        <div className={canSwitchHubs ? '' : 'sm:col-span-2'}>
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Department Type *
                          </label>
                          <CustomSelectModal
                            options={DEPARTMENT_EDIT_OPTIONS}
                            value={formState.departmentType}
                            onChange={(val) =>
                              setFormState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      departmentType:
                                        val as CivicDepartmentType,
                                    }
                                  : prev
                              )
                            }
                            placeholder="Select Department"
                            testId="civic-form-dept-select"
                            className="[&_button]:min-h-[36px] [&_button]:h-9 [&_button]:py-1.5 [&_button]:px-3 [&_button]:rounded-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Locality / Veng
                          </label>
                          <input
                            type="text"
                            value={formState.locality}
                            onChange={(e) =>
                              setFormState((prev) =>
                                prev
                                  ? { ...prev, locality: e.target.value }
                                  : prev
                              )
                            }
                            placeholder="e.g. Tuibong, Dawrpui"
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Official Website (Optional)
                          </label>
                          <input
                            type="url"
                            value={formState.officialWebsite}
                            onChange={(e) =>
                              setFormState((prev) =>
                                prev
                                  ? { ...prev, officialWebsite: e.target.value }
                                  : prev
                              )
                            }
                            placeholder="https://..."
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Full Street Address / Landmark
                          </label>
                          <input
                            type="text"
                            value={formState.address}
                            onChange={(e) =>
                              setFormState((prev) =>
                                prev
                                  ? { ...prev, address: e.target.value }
                                  : prev
                              )
                            }
                            placeholder="Building, road name, nearby landmark"
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Official Map Pin Coordinates
                          </label>
                          <MapCoordinatePicker
                            mode="point"
                            coordinates={{
                              lat: Number(formState.lat) || 24.3333,
                              lng: Number(formState.lng) || 93.6833,
                            }}
                            onChangeCoordinates={(next) =>
                              setFormState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      lat: String(next.lat),
                                      lng: String(next.lng),
                                    }
                                  : prev
                              )
                            }
                            listingVertical="public_civic"
                            localityLabel={formState.locality}
                          />
                        </div>

                        <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] px-3 py-2.5">
                          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formState.is24x7}
                              onChange={(e) =>
                                setFormState((prev) =>
                                  prev
                                    ? { ...prev, is24x7: e.target.checked }
                                    : prev
                                )
                              }
                              className="h-4 w-4 rounded accent-[var(--ps-accent)]"
                            />
                            <span>Open 24×7 (Emergency / Always On)</span>
                          </label>

                          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formState.showNearbyPrintHelper}
                              onChange={(e) =>
                                setFormState((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        showNearbyPrintHelper: e.target.checked,
                                      }
                                    : prev
                                )
                              }
                              className="h-4 w-4 rounded accent-[var(--ps-accent)]"
                            />
                            <span>Show Nearby Print &amp; Digital Helper</span>
                          </label>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Office Hours Text
                          </label>
                          <input
                            type="text"
                            value={formState.officeHoursText}
                            onChange={(e) =>
                              setFormState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      officeHoursText: e.target.value,
                                    }
                                  : prev
                              )
                            }
                            placeholder="e.g. Mon–Fri 10:00 AM – 4:30 PM (Closed 2nd & 4th Sat)"
                            className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                            Important Citizen Notes (Optional)
                          </label>
                          <textarea
                            rows={2}
                            value={formState.importantNotes}
                            onChange={(e) =>
                              setFormState((prev) =>
                                prev
                                  ? { ...prev, importantNotes: e.target.value }
                                  : prev
                              )
                            }
                            placeholder="Token counter timings, lunch break, gate instructions…"
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Helplines List Builder */}
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-theme-primary" />
                            <h4 className="text-xs font-extrabold">
                              Official Helplines ({formState.helplines.length})
                            </h4>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setFormState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      helplines: [
                                        ...prev.helplines,
                                        {
                                          label: '',
                                          phone: '',
                                          is_emergency: false,
                                          whatsapp: false,
                                        },
                                      ],
                                    }
                                  : prev
                              )
                            }
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)] px-2 text-[11px] font-bold text-theme-primary hover:bg-theme-primary/10 cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Add Helpline</span>
                          </button>
                        </div>

                        {formState.helplines.length === 0 ? (
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            No helplines configured yet.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {formState.helplines.map((h, idx) => (
                              <div
                                key={idx}
                                className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-[var(--ps-surface)] p-2.5 space-y-2"
                              >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    value={h.label}
                                    onChange={(e) =>
                                      setFormState((prev) => {
                                        if (!prev) return prev;
                                        const next = [...prev.helplines];
                                        next[idx] = {
                                          ...next[idx],
                                          label: e.target.value,
                                        };
                                        return { ...prev, helplines: next };
                                      })
                                    }
                                    placeholder="Label (e.g. Casualty / Ambulance)"
                                    className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs"
                                  />
                                  <PhoneInputWithCountry
                                    value={h.phone}
                                    onChange={(nextPhone) =>
                                      setFormState((prev) => {
                                        if (!prev) return prev;
                                        const next = [...prev.helplines];
                                        next[idx] = {
                                          ...next[idx],
                                          phone: nextPhone,
                                        };
                                        return { ...prev, helplines: next };
                                      })
                                    }
                                    placeholder="108 or 98620 00000"
                                    allowShortCode
                                    variant="sm"
                                    testId={`civic-helpline-phone-${idx}`}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-3">
                                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={h.is_emergency}
                                        onChange={(e) =>
                                          setFormState((prev) => {
                                            if (!prev) return prev;
                                            const next = [...prev.helplines];
                                            next[idx] = {
                                              ...next[idx],
                                              is_emergency: e.target.checked,
                                            };
                                            return { ...prev, helplines: next };
                                          })
                                        }
                                        className="h-3.5 w-3.5 accent-rose-600"
                                      />
                                      <span className="text-rose-700 dark:text-rose-300">
                                        Emergency
                                      </span>
                                    </label>
                                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={h.whatsapp}
                                        onChange={(e) =>
                                          setFormState((prev) => {
                                            if (!prev) return prev;
                                            const next = [...prev.helplines];
                                            next[idx] = {
                                              ...next[idx],
                                              whatsapp: e.target.checked,
                                            };
                                            return { ...prev, helplines: next };
                                          })
                                        }
                                        className="h-3.5 w-3.5 accent-emerald-600"
                                      />
                                      <span>WhatsApp</span>
                                    </label>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFormState((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              helplines: prev.helplines.filter(
                                                (_, i) => i !== idx
                                              ),
                                            }
                                          : prev
                                      )
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Document Checklists Builder */}
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <FileCheck2 className="h-3.5 w-3.5 text-theme-primary" />
                            <h4 className="text-xs font-extrabold">
                              Required Document Checklists (
                              {formState.checklists.length})
                            </h4>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setFormState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      checklists: [
                                        ...prev.checklists,
                                        {
                                          service_title: '',
                                          required_docs_text: '',
                                          fee_note: '',
                                          processing_time: '',
                                        },
                                      ],
                                    }
                                  : prev
                              )
                            }
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)] px-2 text-[11px] font-bold text-theme-primary hover:bg-theme-primary/10 cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Add Checklist</span>
                          </button>
                        </div>

                        {formState.checklists.length === 0 ? (
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            Optional — add service checklists (e.g. Domicile
                            Certificate, Income Certificate) so citizens know
                            what documents to carry.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {formState.checklists.map((chk, idx) => (
                              <div
                                key={idx}
                                className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-[var(--ps-surface)] p-2.5 space-y-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <input
                                    type="text"
                                    value={chk.service_title}
                                    onChange={(e) =>
                                      setFormState((prev) => {
                                        if (!prev) return prev;
                                        const next = [...prev.checklists];
                                        next[idx] = {
                                          ...next[idx],
                                          service_title: e.target.value,
                                        };
                                        return { ...prev, checklists: next };
                                      })
                                    }
                                    placeholder="Service Title (e.g. Tribal / ST Certificate)"
                                    className="h-8 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs font-semibold"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFormState((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              checklists:
                                                prev.checklists.filter(
                                                  (_, i) => i !== idx
                                                ),
                                            }
                                          : prev
                                      )
                                    }
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                                    title="Remove checklist"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>

                                <textarea
                                  rows={3}
                                  value={chk.required_docs_text}
                                  onChange={(e) =>
                                    setFormState((prev) => {
                                      if (!prev) return prev;
                                      const next = [...prev.checklists];
                                      next[idx] = {
                                        ...next[idx],
                                        required_docs_text: e.target.value,
                                      };
                                      return { ...prev, checklists: next };
                                    })
                                  }
                                  placeholder="Required documents — one per line&#10;Aadhaar Card (original + 2 copies)&#10;2 Passport-size photos&#10;Village Authority / Veng verification letter"
                                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs"
                                />

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    value={chk.fee_note}
                                    onChange={(e) =>
                                      setFormState((prev) => {
                                        if (!prev) return prev;
                                        const next = [...prev.checklists];
                                        next[idx] = {
                                          ...next[idx],
                                          fee_note: e.target.value,
                                        };
                                        return { ...prev, checklists: next };
                                      })
                                    }
                                    placeholder="Fee Note (e.g. ₹20 govt challan)"
                                    className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs"
                                  />
                                  <input
                                    type="text"
                                    value={chk.processing_time}
                                    onChange={(e) =>
                                      setFormState((prev) => {
                                        if (!prev) return prev;
                                        const next = [...prev.checklists];
                                        next[idx] = {
                                          ...next[idx],
                                          processing_time: e.target.value,
                                        };
                                        return { ...prev, checklists: next };
                                      })
                                    }
                                    placeholder="Processing Time (e.g. 3–7 working days)"
                                    className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-4 py-3 bg-[var(--ps-surface)]">
                      <button
                        type="button"
                        disabled={isSavingRecord}
                        onClick={() => setIsEditModalOpen(false)}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingRecord}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-60 cursor-pointer"
                      >
                        {isSavingRecord ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {formState.listingId
                            ? 'Save Changes'
                            : 'Create Civic Office'}
                        </span>
                      </button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* =====================================================================
          MODAL 2: QUICK LIVE CIVIC ALERT MODAL (PORTALED AT z-[90])
          ===================================================================== */}
      {isHydrated &&
        createPortal(
          <AnimatePresence>
            {alertTarget && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!isSavingAlert) setAlertTarget(null);
                }}
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Live Civic Alert"
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 10 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Bell className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="min-w-0">
                        <h3 className="text-sm font-extrabold truncate">
                          Live Civic Alert
                        </h3>
                        <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                          {alertTarget.title}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSavingAlert}
                      onClick={() => setAlertTarget(null)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-4 space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                        Urgent Office Notice / Citizen Banner
                      </label>
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={alertTextDraft}
                        onChange={(e) => setAlertTextDraft(e.target.value)}
                        placeholder="e.g. Counter 2 closed today until 2:00 PM due to server maintenance."
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1.5">
                        Auto-Expire After
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {ALERT_EXPIRY_PRESETS.map((preset) => {
                          const active = alertExpiryHours === preset.hours;
                          return (
                            <button
                              key={preset.hours}
                              type="button"
                              onClick={() => setAlertExpiryHours(preset.hours)}
                              className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                active
                                  ? 'border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                  : 'border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 px-4 py-3">
                    <button
                      type="button"
                      disabled={isSavingAlert}
                      onClick={() => void handleSubmitLiveAlert(true)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-60 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Clear Active Alert</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isSavingAlert}
                        onClick={() => setAlertTarget(null)}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isSavingAlert || !alertTextDraft.trim()}
                        onClick={() => void handleSubmitLiveAlert(false)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60 cursor-pointer"
                      >
                        {isSavingAlert ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        <span>Pin Alert</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* =====================================================================
          MODAL 3: REVIEW CORRECTION REPORT MODAL (PORTALED AT z-[90])
          ===================================================================== */}
      {isHydrated &&
        createPortal(
          <AnimatePresence>
            {reviewTarget && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!isSubmittingReview) setReviewTarget(null);
                }}
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Review Correction Report"
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 10 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                    <h3 className="text-sm font-extrabold">
                      {reviewTarget.decision === 'approved'
                        ? 'Approve Citizen Correction'
                        : 'Reject Citizen Correction'}
                    </h3>
                    <button
                      type="button"
                      disabled={isSubmittingReview}
                      onClick={() => setReviewTarget(null)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 text-xs space-y-1">
                      <div className="font-bold">
                        {reviewTarget.report.listing_title || 'Civic Office'}
                      </div>
                      <div className="text-[11px] font-semibold text-theme-primary">
                        {ISSUE_TYPE_LABELS[reviewTarget.report.issue_type] ||
                          reviewTarget.report.issue_type}
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)]">
                        {reviewTarget.report.suggested_correction}
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                        {reviewTarget.decision === 'rejected'
                          ? 'Rejection Reason * (min 4 chars)'
                          : 'Reviewer Note (Optional)'}
                      </label>
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={reviewerNoteDraft}
                        onChange={(e) => setReviewerNoteDraft(e.target.value)}
                        placeholder={
                          reviewTarget.decision === 'approved'
                            ? 'e.g. Updated helpline & verified office hours.'
                            : 'e.g. Confirmed existing phone number is active.'
                        }
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-4 py-3">
                    <button
                      type="button"
                      disabled={isSubmittingReview}
                      onClick={() => setReviewTarget(null)}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingReview}
                      onClick={() => void handleSubmitCorrectionReview()}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-bold text-white disabled:opacity-60 cursor-pointer ${
                        reviewTarget.decision === 'approved'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-rose-600 hover:bg-rose-700'
                      }`}
                    >
                      {isSubmittingReview ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : reviewTarget.decision === 'approved' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {reviewTarget.decision === 'approved'
                          ? 'Confirm Approval'
                          : 'Confirm Rejection'}
                      </span>
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* =====================================================================
          MODAL 4: LIVE CITIZEN PREVIEW MODAL (CivicSummaryModal)
          ===================================================================== */}
      {previewTarget && (
        <CivicSummaryModal
          listing={buildPreviewListing(previewTarget)}
          initialProfile={previewTarget.civic_profile}
          onClose={() => setPreviewTarget(null)}
        />
      )}

      {confirmDialog}
    </div>
  );
}

export default CivicDirectoryManager;
