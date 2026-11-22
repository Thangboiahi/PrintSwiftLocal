'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export interface PageSubNavPillProps {
  backHref?: string;
  backLabel?: string;
  backTestId?: string;
  children?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  pillClassName?: string;
}

/**
 * Pass V2: Reusable compact floating/inline sub-navigation pill.
 * Renders flush beneath the unified Header + Announcement Bar (`z-[40]`)
 * with zero awkward full-width white strip or empty top gap.
 * Inside AppShell's route scroll container, `--page-subnav-top` resolves to `0px`;
 * on standalone window-scrolled routes it falls back to `var(--app-header-height)`.
 */
export function PageSubNavPill({
  backHref,
  backLabel,
  backTestId,
  children,
  trailing,
  className = '',
  pillClassName = '',
}: PageSubNavPillProps) {
  return (
    <div
      data-testid="page-subnav-pill-wrapper"
      className={`sticky top-[var(--header-visible-height,56px)] z-[40] pointer-events-none pt-2 pb-1 flex flex-wrap items-center justify-between gap-2 transition-[top] duration-300 ease-out ${className}`}
    >
      <div
        className={`pointer-events-auto inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-[var(--ps-border)]/85 bg-[var(--ps-surface)]/92 px-2.5 py-1.5 shadow-sm backdrop-blur-md ${pillClassName}`}
      >
        {backHref && backLabel && (
          <Link
            href={backHref}
            data-testid={backTestId}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-theme-primary shrink-0" />
            <span className="whitespace-nowrap">{backLabel}</span>
          </Link>
        )}
        {children}
      </div>

      {trailing && (
        <div className="pointer-events-auto inline-flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-[var(--ps-border)]/85 bg-[var(--ps-surface)]/92 px-2 py-1 shadow-sm backdrop-blur-md">
          {trailing}
        </div>
      )}
    </div>
  );
}

export default PageSubNavPill;
