'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

interface MediatorDeskRedirectCardProps {
  title?: string;
  description?: string;
  /** Destination of the call-to-action (defaults to the Dispatch Mediator Desk) */
  href?: string;
  ctaLabel?: string;
}

/**
 * v21a (P0-13): the legacy `PickNDropConsole` / `UnifiedPaymentsQueue` wrote escrow and
 * payment rows directly from the browser (no audit trail, stale `payment_intents`, OTP
 * bypasses). All Pick N Drop dispatch, manual UPI verification, escrow release, freeze and
 * refunds now run exclusively through the audited, hub-scoped Dispatch Mediator Desk RPCs.
 */
export function MediatorDeskRedirectCard({
  title = 'Escrow & Dispatch moved to the Mediator Desk',
  description = 'Manual UPI verification, driver dispatch, escrow release, disputes and refunds now run only through the audited, hub-scoped Dispatch Mediator Desk.',
  href = '/workspace?hat=mediator',
  ctaLabel = 'Open Dispatch Mediator Desk',
}: MediatorDeskRedirectCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)]/10 text-[var(--ps-accent)]">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-[var(--ps-text)]">{title}</h3>
          <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">{description}</p>
        </div>
      </div>
      <Link
        href={href}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-extrabold text-[var(--ps-accent-fg)]"
      >
        <span>{ctaLabel}</span>
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export default MediatorDeskRedirectCard;
