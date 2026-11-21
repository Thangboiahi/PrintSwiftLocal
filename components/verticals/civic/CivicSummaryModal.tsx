'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Building2,
  Bus,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crosshair,
  ExternalLink,
  FileCheck2,
  Flag,
  GraduationCap,
  HeartPulse,
  Landmark,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Printer,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { Listing } from '@/lib/types';
import type {
  CivicCorrectionIssueType,
  CivicDepartmentType,
  CivicDocumentChecklist,
  CivicHelpline,
  ListingCivicProfile,
} from '@/lib/verticals/types';

export interface CivicSummaryModalProps {
  listing: Listing;
  initialProfile?: ListingCivicProfile | null;
  onClose: () => void;
  onCenterOnMap?: (listing: Listing) => void;
  onGetDirections?: (listing: Listing) => void;
}

const DEPARTMENT_ICONS: Record<CivicDepartmentType, typeof Landmark> = {
  emergency_medical: HeartPulse,
  police_fire: ShieldAlert,
  government_office: Landmark,
  utility_power_water: Zap,
  public_transport_hub: Bus,
  community_religious: Building2,
  education_public: GraduationCap,
};

const DEPARTMENT_LABELS: Record<CivicDepartmentType, string> = {
  emergency_medical: 'Emergency & Medical Service',
  police_fire: 'Police, Fire & Rescue',
  government_office: 'Government Office',
  utility_power_water: 'Utility · Power & Water',
  public_transport_hub: 'Public Transport Hub',
  community_religious: 'Community & Public Hall',
  education_public: 'Public Education Institution',
};

const CORRECTION_ISSUE_OPTIONS: CustomSelectOption[] = [
  { value: 'wrong_phone', label: 'Wrong Phone Number' },
  { value: 'wrong_hours', label: 'Wrong Office Hours' },
  { value: 'outdated_checklist', label: 'Outdated Document Checklist' },
  { value: 'wrong_location', label: 'Wrong Map Pin / Address' },
  { value: 'closed_relocated', label: 'Closed or Relocated' },
  { value: 'other', label: 'Other Issue' },
];

function sanitizeTelHref(phone: string): string {
  const cleaned = phone.replace(/[^+\d]/g, '');
  return cleaned ? `tel:${cleaned}` : '#';
}

function sanitizeWaHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '#';
}

function formatVerifiedDate(iso: string | null | undefined): string {
  if (!iso) return 'Verified by Hub Desk';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Verified by Hub Desk';
  return `Verified ${d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;
}

export function CivicSummaryModal({
  listing,
  initialProfile = null,
  onClose,
  onCenterOnMap,
  onGetDirections,
}: CivicSummaryModalProps) {
  const [profile, setProfile] = useState<ListingCivicProfile | null>(
    initialProfile
  );
  const [isLoading, setIsLoading] = useState<boolean>(!initialProfile);
  const [nowMs] = useState<number>(() => Date.now());
  const [openChecklistIdx, setOpenChecklistIdx] = useState<number | null>(0);

  // Inline "Report Outdated Info" state (lives inside the SAME modal — zero second popup)
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [issueType, setIssueType] =
    useState<CivicCorrectionIssueType>('wrong_phone');
  const [suggestedCorrection, setSuggestedCorrection] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  // Fetch full listing_civic_profiles row on open if not already passed
  useEffect(() => {
    if (initialProfile || !isSupabaseConfigured()) {
      return;
    }
    let active = true;
    const loadProfile = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('listing_civic_profiles')
          .select('*')
          .eq('listing_id', listing.id)
          .maybeSingle();

        if (!active) return;
        if (!error && data) {
          const row = data as Record<string, unknown>;
          setProfile({
            listing_id: String(row.listing_id || listing.id),
            hub_id: String(row.hub_id || listing.hub_id || ''),
            department_type:
              (row.department_type as CivicDepartmentType) ||
              'government_office',
            is_24x7: Boolean(row.is_24x7),
            office_hours_text:
              typeof row.office_hours_text === 'string'
                ? row.office_hours_text
                : null,
            helplines: Array.isArray(row.helplines)
              ? (row.helplines as CivicHelpline[])
              : [],
            document_checklists: Array.isArray(row.document_checklists)
              ? (row.document_checklists as CivicDocumentChecklist[])
              : [],
            important_notes:
              typeof row.important_notes === 'string'
                ? row.important_notes
                : null,
            live_civic_alert:
              typeof row.live_civic_alert === 'string'
                ? row.live_civic_alert
                : null,
            live_civic_alert_expires_at:
              typeof row.live_civic_alert_expires_at === 'string'
                ? row.live_civic_alert_expires_at
                : null,
            official_website:
              typeof row.official_website === 'string'
                ? row.official_website
                : null,
            show_nearby_print_helper:
              row.show_nearby_print_helper !== undefined
                ? Boolean(row.show_nearby_print_helper)
                : true,
            last_verified_at:
              typeof row.last_verified_at === 'string'
                ? row.last_verified_at
                : null,
            last_verified_by:
              typeof row.last_verified_by === 'string'
                ? row.last_verified_by
                : null,
          });
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    queueMicrotask(() => {
      void loadProfile();
    });
    return () => {
      active = false;
    };
  }, [listing.id, listing.hub_id, initialProfile]);

  // Escape key closes modal cleanly
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const deptType: CivicDepartmentType =
    profile?.department_type ||
    listing.vertical_summary?.department_type ||
    'government_office';
  const DeptIcon = DEPARTMENT_ICONS[deptType] || Landmark;

  const is24x7 = Boolean(
    profile ? profile.is_24x7 : listing.vertical_summary?.is_24x7
  );

  const activeLiveAlert = useMemo(() => {
    const text = profile?.live_civic_alert?.trim();
    if (!text) return null;
    if (profile?.live_civic_alert_expires_at) {
      const exp = new Date(profile.live_civic_alert_expires_at).getTime();
      if (!Number.isNaN(exp) && exp <= nowMs) {
        return null;
      }
    }
    return text;
  }, [profile, nowMs]);

  const helplines = useMemo<CivicHelpline[]>(() => {
    if (profile && Array.isArray(profile.helplines) && profile.helplines.length > 0) {
      return profile.helplines;
    }
    const fallbackPhone =
      (typeof listing.vertical_summary?.primary_phone === 'string' &&
        listing.vertical_summary.primary_phone.trim()) ||
      listing.contactPhone?.trim();
    if (fallbackPhone) {
      return [
        {
          label: 'Primary Citizen Desk',
          phone: fallbackPhone,
          is_emergency:
            deptType === 'emergency_medical' || deptType === 'police_fire',
        },
      ];
    }
    return [];
  }, [profile, listing.vertical_summary, listing.contactPhone, deptType]);

  const checklists = useMemo<CivicDocumentChecklist[]>(
    () =>
      profile && Array.isArray(profile.document_checklists)
        ? profile.document_checklists
        : [],
    [profile]
  );

  const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${listing.coordinates.lat},${listing.coordinates.lng}`
  )}`;

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportError(null);
    setReportSuccess(null);

    const trimmed = suggestedCorrection.trim();
    if (trimmed.length < 8) {
      setReportError('Please enter at least 8 characters describing the update.');
      return;
    }

    setIsSubmittingReport(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/civic/report-correction', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          listingId: listing.id,
          issueType,
          suggestedCorrection: trimmed,
          reporterContact: reporterContact.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        setReportError(json.error || 'Could not submit correction report.');
        return;
      }

      setReportSuccess(
        json.message ||
          'Thank you! Your update has been sent to the local Hub Manager for verification.'
      );
      setSuggestedCorrection('');
      setReporterContact('');
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : 'Network error submitting report.'
      );
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Public directory info for ${listing.title}`}
      data-testid="civic-summary-modal"
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-xl max-h-[90vh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl dark:border-slate-800"
      >
        {/* Sticky Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 bg-slate-50/90 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                deptType === 'emergency_medical'
                  ? 'border-rose-500/30 bg-rose-600/12 text-rose-700 dark:text-rose-300'
                  : deptType === 'police_fire'
                    ? 'border-indigo-500/30 bg-indigo-600/12 text-indigo-700 dark:text-indigo-300'
                    : 'border-slate-400/30 bg-slate-700/10 text-slate-800 dark:text-slate-100'
              }`}
            >
              <DeptIcon className="h-5 w-5" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-800 dark:text-teal-300">
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  Official Public Directory
                </span>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {formatVerifiedDate(profile?.last_verified_at)}
                </span>
              </div>

              <h2 className="mt-1 text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white leading-snug">
                {listing.title}
              </h2>

              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="font-medium">{listing.locality}</span>
                <span>·</span>
                <span>{DEPARTMENT_LABELS[deptType]}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close civic summary"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Terminal Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3.5 space-y-3.5">
          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-14 rounded-xl bg-slate-200/70 dark:bg-slate-800" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="h-14 rounded-xl bg-slate-200/70 dark:bg-slate-800" />
                <div className="h-14 rounded-xl bg-slate-200/70 dark:bg-slate-800" />
              </div>
              <div className="h-24 rounded-xl bg-slate-200/70 dark:bg-slate-800" />
            </div>
          ) : (
            <>
              {/* 1. Live Civic Alert Strip */}
              {activeLiveAlert && (
                <div
                  data-testid="civic-live-alert"
                  className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-amber-950 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 text-xs leading-relaxed">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      Live Branch Notice
                    </div>
                    <p className="mt-0.5 font-medium">{activeLiveAlert}</p>
                  </div>
                </div>
              )}

              {/* 2. Quick-Dial Helplines Directory */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Quick-Dial Helplines
                  </h3>
                  {is24x7 && (
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      OPEN 24×7
                    </span>
                  )}
                </div>

                {helplines.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {helplines.map((line, idx) => (
                      <div
                        key={`${line.phone}-${idx}`}
                        className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${
                          line.is_emergency
                            ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/25'
                            : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {line.is_emergency && (
                              <span className="rounded bg-rose-600 px-1 py-0.5 text-[9px] font-extrabold uppercase text-white shrink-0">
                                EMERGENCY
                              </span>
                            )}
                            <span className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-100">
                              {line.label}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-xs font-extrabold text-slate-900 dark:text-white">
                            {line.phone}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {line.whatsapp && (
                            <a
                              href={sanitizeWaHref(line.phone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`WhatsApp ${line.label}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <a
                            href={sanitizeTelHref(line.phone)}
                            aria-label={`Call ${line.label}`}
                            className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold shadow-2xs transition ${
                              line.is_emergency
                                ? 'bg-rose-600 text-white hover:bg-rose-700'
                                : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-teal-700 dark:hover:bg-teal-600'
                            }`}
                          >
                            <Phone className="h-3 w-3" />
                            <span>Dial</span>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
                    No direct phone helpline published for this office yet.
                  </p>
                )}
              </section>

              {/* 3. Office Hours, Address & Directions */}
              <section className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 space-y-2.5 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-start gap-2 text-xs">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Hours &amp; Counter Timings
                    </div>
                    <p className="mt-0.5 font-semibold text-slate-800 dark:text-slate-100">
                      {profile?.office_hours_text ||
                        (is24x7
                          ? 'Open 24 Hours · 7 Days a Week'
                          : 'Standard Government Working Hours (Mon–Fri)')}
                    </p>
                  </div>
                </div>

                {listing.address && (
                  <div className="flex items-start gap-2 text-xs">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Location &amp; Address
                      </div>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                        {listing.address}
                      </p>
                    </div>
                  </div>
                )}

                {profile?.important_notes && (
                  <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                    <span className="font-bold text-slate-900 dark:text-white">
                      Citizen Note:{' '}
                    </span>
                    {profile.important_notes}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {onGetDirections ? (
                    <button
                      type="button"
                      onClick={() => {
                        onGetDirections(listing);
                        onClose();
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 text-xs font-semibold text-[var(--color-primary-foreground)] shadow-2xs transition hover:opacity-95"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                      <span>Route on Map</span>
                    </button>
                  ) : null}

                  <a
                    href={googleMapsDirUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Google Maps</span>
                  </a>

                  {onCenterOnMap && (
                    <button
                      type="button"
                      onClick={() => {
                        onCenterOnMap(listing);
                        onClose();
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      <span>Highlight Pin</span>
                    </button>
                  )}

                  {profile?.official_website && (
                    <a
                      href={profile.official_website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-800 dark:text-teal-300 transition-colors"
                    >
                      <span>Official Portal</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </section>

              {/* 4. Required Documents Checklists (Collapsible Accordions) */}
              {checklists.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <FileCheck2 className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
                      Required Documents Checklists
                    </h3>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {checklists.length}{' '}
                      {checklists.length === 1 ? 'service' : 'services'}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {checklists.map((ck, idx) => {
                      const isOpen = openChecklistIdx === idx;
                      return (
                        <div
                          key={`${ck.service_title}-${idx}`}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setOpenChecklistIdx(isOpen ? null : idx)
                            }
                            aria-expanded={isOpen}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-bold text-slate-900 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/50 transition-colors"
                          >
                            <span className="min-w-0 truncate">
                              {ck.service_title}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {ck.required_docs.length} docs
                              </span>
                              <ChevronDown
                                className={`h-4 w-4 text-slate-400 transition-transform ${
                                  isOpen ? 'rotate-180' : ''
                                }`}
                              />
                            </div>
                          </button>

                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.16 }}
                                className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
                              >
                                <div className="px-3 py-2.5 space-y-2 text-xs">
                                  <ul className="space-y-1.5 text-slate-700 dark:text-slate-300">
                                    {ck.required_docs.map((doc, dIdx) => (
                                      <li
                                        key={`${doc}-${dIdx}`}
                                        className="flex items-start gap-2"
                                      >
                                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                                        <span>{doc}</span>
                                      </li>
                                    ))}
                                  </ul>

                                  {(ck.fee_note || ck.processing_time) && (
                                    <div className="flex flex-wrap gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                                      {ck.fee_note && (
                                        <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                          Fee: {ck.fee_note}
                                        </span>
                                      )}
                                      {ck.processing_time && (
                                        <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                          Time: {ck.processing_time}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 5. Cross-Vertical Flywheel Banner (Print & Digital Helper) */}
              {profile?.show_nearby_print_helper !== false &&
                checklists.length > 0 && (
                  <div
                    data-testid="civic-print-flywheel-banner"
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-teal-500/25 bg-teal-500/8 p-3 dark:border-teal-500/30 dark:bg-teal-950/30"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-primary text-[hsl(var(--color-primary-foreground))]">
                        <Printer className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 text-xs">
                        <div className="font-bold text-slate-900 dark:text-white">
                          Preparing documents before you visit?
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          Need photocopies, PDF prints, or online form
                          assistance nearby?
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/explore?category=printing_digital_services"
                      onClick={onClose}
                      className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-theme-primary px-3 text-xs font-bold text-[hsl(var(--color-primary-foreground))] shadow-2xs transition hover:opacity-95 whitespace-nowrap"
                    >
                      <span>Find Print &amp; Digital Shops →</span>
                    </Link>
                  </div>
                )}

              {/* 6. Inline "Report Outdated Info" Accordion (Inside Same Modal) */}
              <section className="rounded-xl border border-slate-200/90 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setIsReportOpen((prev) => !prev);
                    setReportError(null);
                  }}
                  data-testid="civic-toggle-report-btn"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Flag className="h-3.5 w-3.5 text-slate-500" />
                    <span>Report Outdated Info or Suggest Correction</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform ${
                      isReportOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isReportOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="overflow-hidden border-t border-slate-200/80 dark:border-slate-800"
                    >
                      <form
                        onSubmit={(e) => void handleSubmitCorrection(e)}
                        className="p-3 space-y-2.5"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                              What needs updating?
                            </label>
                            <CustomSelectModal
                              value={issueType}
                              onChange={(val) =>
                                setIssueType(val as CivicCorrectionIssueType)
                              }
                              options={CORRECTION_ISSUE_OPTIONS}
                              label="Select Issue Type"
                              placeholder="Select issue type"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                              Your Phone / Email (Optional)
                            </label>
                            <input
                              type="text"
                              value={reporterContact}
                              onChange={(e) =>
                                setReporterContact(e.target.value)
                              }
                              placeholder="For follow-up if needed"
                              className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--color-primary)] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Suggested Correction{' '}
                            <span className="text-rose-500">*</span>
                          </label>
                          <textarea
                            rows={2}
                            required
                            value={suggestedCorrection}
                            onChange={(e) =>
                              setSuggestedCorrection(e.target.value)
                            }
                            placeholder="Share the corrected phone number, updated counter timing, or document requirement…"
                            className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--color-primary)] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />
                        </div>

                        {reportError && (
                          <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                            {reportError}
                          </div>
                        )}

                        {reportSuccess && (
                          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>{reportSuccess}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-end">
                          <button
                            type="submit"
                            disabled={isSubmittingReport}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-teal-700 dark:hover:bg-teal-600"
                          >
                            {isSubmittingReport ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            <span>Submit Update</span>
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default CivicSummaryModal;
