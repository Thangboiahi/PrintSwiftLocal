'use client';

import React from 'react';
import {
  AlertTriangle,
  Bookmark,
  Building2,
  Bus,
  Clock,
  Crosshair,
  FileCheck2,
  GraduationCap,
  HeartPulse,
  Landmark,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import type { Listing } from '@/lib/types';
import type { CivicDepartmentType } from '@/lib/verticals/types';

export interface CivicMapCardProps {
  item: Listing;
  isSaved: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isMobileLandscape: boolean;
  showOutsideViewportBadge?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenCivicSummary: () => void;
  onCenterOnMap: () => void;
  onToggleSave: () => void;
}

const DEPARTMENT_META: Record<
  CivicDepartmentType,
  {
    label: string;
    icon: typeof Landmark;
    badgeTone: string;
    iconTone: string;
  }
> = {
  emergency_medical: {
    label: 'Emergency & Medical',
    icon: HeartPulse,
    badgeTone:
      'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    iconTone:
      'bg-rose-600/12 text-rose-700 border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  },
  police_fire: {
    label: 'Police, Fire & Rescue',
    icon: ShieldAlert,
    badgeTone:
      'bg-indigo-50 text-indigo-700 border-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/60',
    iconTone:
      'bg-indigo-600/12 text-indigo-700 border-indigo-500/25 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  },
  government_office: {
    label: 'Government Office',
    icon: Landmark,
    badgeTone:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    iconTone:
      'bg-slate-700/12 text-slate-700 border-slate-500/25 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-500/30',
  },
  utility_power_water: {
    label: 'Electricity & Water',
    icon: Zap,
    badgeTone:
      'bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
    iconTone:
      'bg-amber-600/12 text-amber-700 border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  },
  public_transport_hub: {
    label: 'Public Transport Hub',
    icon: Bus,
    badgeTone:
      'bg-teal-50 text-teal-800 border-teal-200/80 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/60',
    iconTone:
      'bg-teal-600/12 text-teal-700 border-teal-500/25 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30',
  },
  community_religious: {
    label: 'Community & Public Hall',
    icon: Building2,
    badgeTone:
      'bg-teal-50 text-teal-800 border-teal-200/80 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/60',
    iconTone:
      'bg-teal-600/12 text-teal-700 border-teal-500/25 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30',
  },
  education_public: {
    label: 'Public Education',
    icon: GraduationCap,
    badgeTone:
      'bg-sky-50 text-sky-800 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60',
    iconTone:
      'bg-sky-600/12 text-sky-700 border-sky-500/25 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  },
};

function sanitizeDialHref(phone: string): string {
  const cleaned = phone.replace(/[^+\d]/g, '');
  return cleaned ? `tel:${cleaned}` : '#';
}

export function CivicMapCard({
  item,
  isSaved,
  isHovered,
  isSelected,
  isMobileLandscape,
  showOutsideViewportBadge = false,
  onMouseEnter,
  onMouseLeave,
  onOpenCivicSummary,
  onCenterOnMap,
  onToggleSave,
}: CivicMapCardProps) {
  const summary = item.vertical_summary || {};
  const deptType: CivicDepartmentType =
    summary.department_type && summary.department_type in DEPARTMENT_META
      ? summary.department_type
      : 'government_office';
  const dept = DEPARTMENT_META[deptType];
  const DeptIcon = dept.icon;

  const is24x7 = Boolean(summary.is_24x7);
  const hasActiveAlert = Boolean(summary.has_active_alert);
  const helplineCount = Number(summary.helpline_count || 0);
  const checklistCount = Number(summary.checklist_count || 0);
  const primaryPhone =
    (typeof summary.primary_phone === 'string' && summary.primary_phone.trim()) ||
    item.contactPhone?.trim() ||
    '';

  const { isSaved: isUnifiedSaved, toggleSave: toggleUnifiedSave } =
    useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);

  return (
    <div
      data-testid={`civic-map-card-${item.id}`}
      data-listing-id={item.id}
      data-listing-vertical="public_civic"
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onOpenCivicSummary}
      className={`group relative w-full max-w-[440px] mx-auto rounded-xl border transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
      } flex flex-col justify-between bg-slate-50/90 dark:bg-slate-900/95 ${
        isSelected
          ? 'border-slate-700 dark:border-teal-400 ring-1 ring-slate-700/30 dark:ring-teal-400/30 shadow-sm'
          : isHovered
            ? 'border-slate-500/70 dark:border-slate-600 shadow-sm'
            : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-400/80 dark:hover:border-slate-700 shadow-2xs'
      }`}
    >
      {/* Top Row: Civic Emblem + Official Badges + Quick Map/Save Icons */}
      <div className="flex items-start gap-2.5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${dept.iconTone}`}
        >
          <DeptIcon className="h-5 w-5" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <span className="inline-flex items-center gap-1 rounded border border-slate-300/80 bg-slate-200/70 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <ShieldCheck className="h-2.5 w-2.5 text-teal-700 dark:text-teal-400 shrink-0" />
                Official Public Info
              </span>

              {is24x7 ? (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Open 24×7
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded bg-slate-200/50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                  <Clock className="h-2.5 w-2.5 shrink-0" />
                  Office Hours
                </span>
              )}

              {hasActiveAlert && (
                <span
                  title="Active Civic Notice"
                  className="inline-flex items-center gap-1 rounded border border-amber-300/80 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Alert
                </span>
              )}

              {showOutsideViewportBadge && (
                <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                  Outside View
                </span>
              )}
            </div>

            <div className="flex items-center shrink-0 gap-0.5 -mr-1 -mt-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCenterOnMap();
                }}
                aria-label={`Locate ${item.title} on map`}
                title="Locate on Map"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSave();
                  void toggleUnifiedSave('listing', item.id);
                }}
                aria-label={effectiveSaved ? 'Remove from saved' : 'Save public service'}
                title={effectiveSaved ? 'Saved' : 'Save'}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
              >
                <Bookmark
                  className={`h-3.5 w-3.5 ${
                    effectiveSaved
                      ? 'fill-current text-[var(--ps-accent)]'
                      : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          <h3 className="mt-1 line-clamp-1 text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
            {item.title}
          </h3>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="truncate font-medium">{item.locality}</span>
            </span>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {dept.label}
            </span>
          </div>
        </div>
      </div>

      {/* Lightweight Metadata Strip (Helplines & Document Checklists count — zero price/cart clutter) */}
      {(helplineCount > 0 || checklistCount > 0 || hasActiveAlert) && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600 dark:text-slate-400">
          {helplineCount > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold">
              <Phone className="h-3 w-3 text-teal-700 dark:text-teal-400" />
              {helplineCount} {helplineCount === 1 ? 'Helpline' : 'Helplines'}
            </span>
          )}
          {checklistCount > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold">
              <FileCheck2 className="h-3 w-3 text-slate-500 dark:text-slate-400" />
              {checklistCount}{' '}
              {checklistCount === 1 ? 'Doc Checklist' : 'Doc Checklists'}
            </span>
          )}
          {hasActiveAlert && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Live Notice Inside
            </span>
          )}
        </div>
      )}

      {/* Action Footer: 1-Tap Call + View Contacts & Info (Terminates in CivicSummaryModal) */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
        {primaryPhone && (
          <a
            href={sanitizeDialHref(primaryPhone)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Call ${item.title} at ${primaryPhone}`}
            data-testid={`civic-quick-call-${item.id}`}
            className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold shadow-2xs transition ${
              deptType === 'emergency_medical' || deptType === 'police_fire'
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Call</span>
          </a>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCivicSummary();
          }}
          data-testid={`civic-view-info-${item.id}`}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white shadow-2xs transition hover:bg-slate-900 dark:bg-teal-700 dark:hover:bg-teal-600"
        >
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">View Contacts &amp; Info</span>
        </button>
      </div>
    </div>
  );
}

export default CivicMapCard;
