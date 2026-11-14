'use client';

import React from 'react';
import { Listing } from '@/lib/types';
import { calculateListingCompleteness, hasValidMandatoryPanorama } from '@/lib/rules';
import { AlertCircle, CheckCircle2, Compass } from 'lucide-react';

export interface CompletenessIndicatorProps {
  listing: Listing & { panoramaUrl?: string | null };
  panoramaUrl?: string | null;
  compact?: boolean;
  className?: string;
}

export function CompletenessIndicator({
  listing,
  panoramaUrl,
  compact = false,
  className = '',
}: CompletenessIndicatorProps) {
  const { score, missingItems } = calculateListingCompleteness(listing);

  // Check if panorama is missing either via explicit panoramaUrl === null or real estate mandatory 360 check
  const effectivePanoramaUrl =
    panoramaUrl !== undefined ? panoramaUrl : listing.panoramaUrl;
  const isMissingPanorama =
    effectivePanoramaUrl === null ||
    (listing.category === 'real_estate' &&
      !hasValidMandatoryPanorama(listing) &&
      !effectivePanoramaUrl);

  const flags: string[] = missingItems.map((item) =>
    item.key === 'panorama' ? 'Add 360° Panorama' : item.label
  );

  if (
    isMissingPanorama &&
    !flags.some((field) => field.toLowerCase().includes('panorama'))
  ) {
    flags.unshift('Add 360° Panorama');
  }

  const adjustedScore =
    isMissingPanorama && score === 100 ? 80 : score;

  const barColor =
    adjustedScore === 100
      ? 'bg-emerald-500'
      : adjustedScore >= 75
      ? 'bg-amber-500'
      : 'bg-rose-500';

  if (compact) {
    return (
      <div className={`space-y-1.5 min-w-[140px] ${className}`}>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono font-bold text-[var(--ps-text)]">
            {adjustedScore}%
          </span>
          {isMissingPanorama ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
              <Compass className="w-3 h-3" /> Add 360° Panorama
            </span>
          ) : adjustedScore === 100 ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Complete
            </span>
          ) : (
            <span className="text-[10px] text-[var(--ps-text-muted)]">
              {flags.length} missing
            </span>
          )}
        </div>
        <div className="w-full h-1.5 bg-[var(--ps-bg)] rounded-full overflow-hidden border border-[var(--ps-border)]">
          <div
            className={`h-full transition-all ${barColor}`}
            style={{ width: `${adjustedScore}%` }}
          />
        </div>
        {flags.length > 0 && (
          <div className="text-[10px] text-amber-400/90 truncate">
            {flags.join(' • ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-elevated)] p-2.5 space-y-2 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--ps-text)]">
          Listing Completeness
        </span>
        <span
          className={`text-xs font-mono font-bold ${
            adjustedScore === 100
              ? 'text-emerald-400'
              : adjustedScore >= 75
              ? 'text-amber-400'
              : 'text-rose-400'
          }`}
        >
          {adjustedScore}%
        </span>
      </div>

      <div className="w-full h-1.5 bg-[var(--ps-bg)] rounded-full overflow-hidden border border-[var(--ps-border)]">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${adjustedScore}%` }}
        />
      </div>

      {flags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {flags.map((flag) => {
            const isPanoramaFlag = flag.toLowerCase().includes('panorama');
            return (
              <span
                key={flag}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${
                  isPanoramaFlag
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                }`}
              >
                {isPanoramaFlag ? (
                  <Compass className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                {flag}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>All publication requirements met</span>
        </div>
      )}
    </div>
  );
}
