'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
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
  Zap,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import type { Listing } from '@/lib/types';
import {
  buildContextualWhatsAppUrl,
  normalizeWhatsAppPhone,
} from '@/lib/utils/whatsapp';
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

function buildCivicWaHref(
  phone: string,
  listing: Listing,
  label?: string
): string {
  const digits = normalizeWhatsAppPhone(phone);
  if (!digits) return '#';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
  return buildContextualWhatsAppUrl(digits, {
    type: 'listing_enquiry',
    listingTitle: listing.title,
    locality: listing.locality,
    url: origin
      ? `${origin}/civic?focus=${encodeURIComponent(listing.id)}`
      : null,
    customNote: label ? `Enquiring with ${label}.` : null,
  });
}

function formatVerifiedDate(iso: string | null | undefined): string {
  if (!iso) return 'Verified by Hub Desk';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Verified by Hub Desk';
  return `Verified ${d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
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
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
  }, []);

  const [openChecklistIdx, setOpenChecklistIdx] = useState<number | null>(0);

  // Inline "Report Outdated Info" state (lives inside the SAME sheet — zero second popup)
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [issueType, setIssueType] =
    useState<CivicCorrectionIssueType>('wrong_phone');
  const [suggestedCorrection, setSuggestedCorrection] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const { confirm: confirmCorrection, dialog: confirmCorrectionDialog } =
    useConfirmDialog();

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
    if (
      profile &&
      Array.isArray(profile.helplines) &&
      profile.helplines.length > 0
    ) {
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

  const primaryHelpline = helplines[0] || null;

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportError(null);
    setReportSuccess(null);

    const trimmed = suggestedCorrection.trim();
    if (trimmed.length < 8) {
      setReportError(
        'Please enter at least 8 characters describing the update.'
      );
      return;
    }

    const ok = await confirmCorrection({
      title: 'Submit Public Info Correction?',
      description: `Your update for "${listing.title.replace(/^\[SAMPLE\]\s*/i, '')}" will be reviewed by the local Hub Manager.`,
      confirmLabel: 'Confirm & Submit',
      cancelLabel: 'Edit',
      variant: 'default',
    });
    if (!ok) return;

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

  return (
    <>
      <ListingSummarySheetShell
        listing={listing}
        onClose={onClose}
        hideSaveButton
        maxWidthClassName="max-w-xl"
        testId="civic-summary-modal"
        ariaLabel={`Public directory info for ${listing.title}`}
        categoryLabel={DEPARTMENT_LABELS[deptType]}
        shareVerticalBadge="Public & Civic"
        sharePriceLabel={is24x7 ? '24×7 Helpline' : null}
        isVerifiedOverride
        shareOverrides={{
          url: `/civic?focus=${encodeURIComponent(listing.id)}`,
          text: `${listing.title} (${listing.locality})${
            primaryHelpline?.phone ? ` · Helpline: ${primaryHelpline.phone}` : ''
          }`,
        }}
        verticalBadgeSlot={
          <span className="inline-flex items-center gap-1 rounded-md bg-teal-700/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
            <DeptIcon className="h-3 w-3 shrink-0" />
            <span>Public Directory</span>
          </span>
        }
        identityExtraSlot={
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px]">
            <span className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 font-bold text-teal-800 dark:text-teal-300">
              <ShieldCheck className="h-3 w-3 shrink-0" />
              {formatVerifiedDate(profile?.last_verified_at)}
            </span>
            {is24x7 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/12 px-1.5 py-0.5 font-bold text-emerald-700 dark:text-emerald-300">
                OPEN 24×7
              </span>
            )}
          </div>
        }
        footerSlot={
          <div className="flex flex-wrap items-center gap-2">
            {primaryHelpline ? (
              <a
                href={sanitizeTelHref(primaryHelpline.phone)}
                className={`inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-bold shadow-xs transition ${
                  primaryHelpline.is_emergency
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95'
                }`}
              >
                <Phone className="h-4 w-4" />
                <span>Call {primaryHelpline.phone}</span>
              </a>
            ) : null}

            {onGetDirections ? (
              <button
                type="button"
                onClick={() => {
                  onGetDirections(listing);
                  onClose();
                }}
                className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
              >
                <Navigation className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Route on Map</span>
              </button>
            ) : (
              <a
                href={googleMapsDirUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
              >
                <ExternalLink className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Google Maps</span>
              </a>
            )}
          </div>
        }
      >
        {isLoading ? (
          <div className="space-y-3">
            <div className="dd-shimmer h-14 rounded-xl bg-[var(--ps-surface-alt)]" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="dd-shimmer h-14 rounded-xl bg-[var(--ps-surface-alt)]" />
              <div className="dd-shimmer h-14 rounded-xl bg-[var(--ps-surface-alt)]" />
            </div>
            <div className="dd-shimmer h-36 rounded-xl bg-[var(--ps-surface-alt)]" />
          </div>
        ) : (
          <div className="space-y-3.5">
            {/* 1. Live Civic Alert Strip */}
            {activeLiveAlert && (
              <div
                data-testid="civic-live-alert"
                className="flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-200"
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
              <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Quick-Dial Helplines
              </h3>

              {helplines.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {helplines.map((line, idx) => (
                    <div
                      key={`${line.phone}-${idx}`}
                      className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${
                        line.is_emergency
                          ? 'border-rose-500/30 bg-rose-500/8'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {line.is_emergency && (
                            <span className="rounded bg-rose-600 px-1 py-0.5 text-[9px] font-extrabold uppercase text-white shrink-0">
                              EMERGENCY
                            </span>
                          )}
                          <span className="truncate text-[11px] font-bold text-[var(--ps-text)]">
                            {line.label}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-xs font-extrabold text-[var(--ps-text)]">
                          {line.phone}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {line.whatsapp && (
                          <a
                            href={buildCivicWaHref(
                              line.phone,
                              listing,
                              line.label
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`WhatsApp ${line.label}`}
                            className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        )}
                        <a
                          href={sanitizeTelHref(line.phone)}
                          aria-label={`Call ${line.label}`}
                          className={`inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold shadow-2xs transition ${
                            line.is_emergency
                              ? 'bg-rose-600 text-white hover:bg-rose-700'
                              : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95'
                          }`}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          <span>Dial</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--ps-border)] px-3 py-2 text-xs text-[var(--ps-text-muted)]">
                  No direct phone helpline published for this office yet.
                </p>
              )}
            </section>

            {/* 3. Office Hours, Address & Directions */}
            <section className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2.5">
              <div className="flex items-start gap-2 text-xs">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)]">
                    Hours &amp; Counter Timings
                  </div>
                  <p className="mt-0.5 font-semibold text-[var(--ps-text)]">
                    {profile?.office_hours_text ||
                      (is24x7
                        ? 'Open 24 Hours · 7 Days a Week'
                        : 'Standard Government Working Hours (Mon–Fri)')}
                  </p>
                </div>
              </div>

              {listing.address && (
                <div className="flex items-start gap-2 text-xs">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)]" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)]">
                      Location &amp; Address
                    </div>
                    <p className="mt-0.5 text-[var(--ps-text)]">
                      {listing.address}
                    </p>
                  </div>
                </div>
              )}

              {profile?.important_notes && (
                <div className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-2 text-[11px] text-[var(--ps-text-muted)]">
                  <span className="font-bold text-[var(--ps-text)]">
                    Citizen Note:{' '}
                  </span>
                  {profile.important_notes}
                </div>
              )}

              <DynamicListingLocationMap
                listingId={listing.id}
                title={listing.title}
                locality={listing.locality}
                address={listing.address}
                coordinates={listing.coordinates}
                listingVertical="public_civic"
                showPickNDrop={false}
                compact
              />

              {(onCenterOnMap || profile?.official_website) && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {onCenterOnMap && (
                    <button
                      type="button"
                      onClick={() => {
                        onCenterOnMap(listing);
                        onClose();
                      }}
                      className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
                    >
                      <Crosshair className="h-4 w-4" />
                      <span>Highlight Pin</span>
                    </button>
                  )}

                  {profile?.official_website && (
                    <a
                      href={profile.official_website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-bold text-teal-700 hover:border-teal-500 dark:text-teal-300 transition-colors"
                    >
                      <span>Official Portal</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </section>

            {/* 4. Required Documents Checklists (Collapsible Accordions) */}
            {checklists.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    <FileCheck2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    Required Documents Checklists
                  </h3>
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
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
                        className="overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenChecklistIdx(isOpen ? null : idx)
                          }
                          aria-expanded={isOpen}
                          className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                        >
                          <span className="min-w-0 truncate">
                            {ck.service_title}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                              {ck.required_docs.length} docs
                            </span>
                            <ChevronDown
                              className={`h-4 w-4 text-[var(--ps-text-muted)] transition-transform ${
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
                              className="overflow-hidden border-t border-[var(--ps-border)]"
                            >
                              <div className="px-3 py-2.5 space-y-2 text-xs">
                                <ul className="space-y-1.5 text-[var(--ps-text)]">
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
                                  <div className="flex flex-wrap gap-2 pt-1.5 border-t border-[var(--ps-border)] text-[11px]">
                                    {ck.fee_note && (
                                      <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 font-semibold text-[var(--ps-text)]">
                                        Fee: {ck.fee_note}
                                      </span>
                                    )}
                                    {ck.processing_time && (
                                      <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 font-semibold text-[var(--ps-text)]">
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
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-teal-500/25 bg-teal-500/8 p-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]">
                      <Printer className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 text-xs">
                      <div className="font-bold text-[var(--ps-text)]">
                        Preparing documents before you visit?
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)]">
                        Need photocopies, PDF prints, or online form assistance
                        nearby?
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/explore?category=printing_digital_services"
                    onClick={onClose}
                    className="inline-flex min-h-[44px] h-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95 whitespace-nowrap"
                  >
                    <span>Find Print &amp; Digital Shops →</span>
                  </Link>
                </div>
              )}

            {/* 6. Inline "Report Outdated Info" Accordion */}
            <section className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setIsReportOpen((prev) => !prev);
                  setReportError(null);
                }}
                data-testid="civic-toggle-report-btn"
                className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Flag className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                  <span>Report Outdated Info or Suggest Correction</span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-[var(--ps-text-muted)] transition-transform ${
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
                    className="overflow-hidden border-t border-[var(--ps-border)]"
                  >
                    <form
                      onSubmit={(e) => void handleSubmitCorrection(e)}
                      className="p-3 space-y-2.5"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
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
                            className="min-h-[44px] text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                            Your Phone / Email (Optional)
                          </label>
                          <input
                            type="text"
                            value={reporterContact}
                            onChange={(e) =>
                              setReporterContact(e.target.value)
                            }
                            placeholder="For follow-up if needed"
                            className="min-h-[44px] h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
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
                          className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
                        />
                      </div>

                      {reportError && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                          {reportError}
                        </div>
                      )}

                      {reportSuccess && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>{reportSuccess}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-end">
                        <button
                          type="submit"
                          disabled={isSubmittingReport}
                          className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-60 cursor-pointer"
                        >
                          {isSubmittingReport ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          <span>Submit Update</span>
                        </button>
                      </div>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        )}
      </ListingSummarySheetShell>
      {confirmCorrectionDialog}
    </>
  );
}

export default CivicSummaryModal;
