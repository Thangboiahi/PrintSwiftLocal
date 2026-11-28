'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  FileText,
  IndianRupee,
  Lock,
  MessageCircle,
  Phone,
  Printer,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  Wallet,
} from 'lucide-react';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import {
  getVerifiedCapabilityChipLabels,
  isPrintProfileBusyPaused,
  TURNAROUND_BADGE_LABELS,
} from '@/lib/print-orders/client-helpers';
import type { ListingPrintProfile } from '@/lib/print-orders/types';
import {
  buildContextualWhatsAppUrl,
  normalizeWhatsAppPhone,
} from '@/lib/utils/whatsapp';

export type ListingProvenanceTier = 'submitted' | 'claimed' | 'verified';

export interface PrintServiceCardProps {
  listingId: string;
  listingTitle: string;
  listingLocality: string;
  profile: ListingPrintProfile | null;
  hasActiveEntitlement: boolean;
  isPrintingCategory: boolean;
  provenanceTier?: ListingProvenanceTier;
  providerClaimedServices?: string[];
  indicativePriceNote?: string | null;
  contactPhone?: string | null;
  whatsappPhone?: string | null;
  isPrintModuleEnabled?: boolean;
}

function sanitizeDigits(raw: string | null | undefined): string {
  return String(raw || '').replace(/[^\d]/g, '');
}

export function PrintServiceCard({
  listingId,
  listingTitle,
  listingLocality,
  profile,
  hasActiveEntitlement,
  isPrintingCategory,
  provenanceTier = 'submitted',
  providerClaimedServices = [],
  indicativePriceNote = null,
  contactPhone = null,
  whatsappPhone = null,
  isPrintModuleEnabled = true,
}: PrintServiceCardProps) {
  const isHydrated = useHydrated();
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
  }, []);

  const isFirstParty = Boolean(profile?.is_first_party_printswift);
  const isSubscribedPrintPro = Boolean(
    profile && !isFirstParty && hasActiveEntitlement
  );

  const isBusyPaused = useMemo(
    () => (nowMs > 0 ? isPrintProfileBusyPaused(profile?.busy_until, nowMs) : false),
    [profile?.busy_until, nowMs]
  );

  // If neither Official PrintSwift, nor Subscribed Print Pro, nor a Printing & Digital listing, render nothing
  if (!isFirstParty && !isSubscribedPrintPro && !isPrintingCategory) {
    return null;
  }

  // =========================================================================
  // STATE 1: OFFICIAL FIRST-PARTY PRINTSWIFT
  // =========================================================================
  if (isFirstParty && profile) {
    const isLiveAccepting =
      isPrintModuleEnabled && profile.is_accepting_orders && !isBusyPaused;
    const confirmedCapabilities = getVerifiedCapabilityChipLabels(profile, false);
    const rc = profile.rate_card;
    const rateRows: Array<{ label: string; value: string }> = [];
    if (typeof rc.bw_a4_single_inr === 'number' && rc.bw_a4_single_inr > 0) {
      rateRows.push({
        label: 'B&W A4 (Single)',
        value: `₹${rc.bw_a4_single_inr}/pg`,
      });
    }
    if (typeof rc.bw_a4_duplex_inr === 'number' && rc.bw_a4_duplex_inr > 0) {
      rateRows.push({
        label: 'B&W A4 (Duplex)',
        value: `₹${rc.bw_a4_duplex_inr}/sheet`,
      });
    }
    if (
      typeof rc.color_a4_single_inr === 'number' &&
      rc.color_a4_single_inr > 0
    ) {
      rateRows.push({
        label: 'Color A4',
        value: `₹${rc.color_a4_single_inr}/pg`,
      });
    }
    if (
      typeof rc.spiral_binding_inr === 'number' &&
      rc.spiral_binding_inr > 0
    ) {
      rateRows.push({
        label: 'Spiral Binding',
        value: `₹${rc.spiral_binding_inr}`,
      });
    }
    if (
      typeof rc.lamination_per_sheet_inr === 'number' &&
      rc.lamination_per_sheet_inr > 0
    ) {
      rateRows.push({
        label: 'A4 Lamination',
        value: `₹${rc.lamination_per_sheet_inr}`,
      });
    }

    const turnaroundMeta = TURNAROUND_BADGE_LABELS[profile.turnaround_badge];

    return (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        data-testid="print-service-card-official"
        className="overflow-hidden rounded-2xl border-2 border-theme-primary/50 bg-[var(--ps-surface)] shadow-sm"
      >
        {/* Structurally Distinct First-Party Header */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-theme-primary/20 bg-theme-primary/8 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-theme-primary/25 bg-[var(--ps-surface)] shadow-2xs">
              <DDoodleLogo variant="mark" size={24} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-theme-primary px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[hsl(var(--color-primary-foreground))]">
                  <BadgeCheck className="h-3 w-3" />
                  <span>OFFICIAL DD OODLE PRINT</span>
                </span>
                {isLiveAccepting ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${turnaroundMeta.className}`}
                  >
                    <Clock className="h-3 w-3" />
                    <span>{turnaroundMeta.label}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    <Clock className="h-3 w-3" />
                    <span>Pre-Launch Preview</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                First-party DD oodle print &amp; document counter with platform
                escrow protection
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            <Lock className="h-3 w-3 shrink-0" />
            <span>48-Hour Auto-Delete Privacy Guarantee</span>
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Confirmed Capabilities */}
          {confirmedCapabilities.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Confirmed Capabilities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {confirmedCapabilities.map((cap) => (
                  <span
                    key={cap}
                    className="inline-flex items-center gap-1 rounded-lg border border-theme-primary/25 bg-theme-primary/8 px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)]"
                  >
                    <ShieldCheck className="h-3 w-3 text-theme-primary shrink-0" />
                    <span>{cap}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Transparent Starting Rates (only rendered if configured) */}
          {rateRows.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Transparent Starting Rates
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {rateRows.map((row) => (
                  <div
                    key={row.label}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2"
                  >
                    <p className="text-[10px] font-medium text-[var(--ps-text-muted)]">
                      {row.label}
                    </p>
                    <p className="mt-0.5 text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                      {row.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pickup / Operating Instructions if present */}
          {profile.pickup_instructions && (
            <p className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 px-3 py-2 text-xs text-[var(--ps-text-muted)]">
              {profile.pickup_instructions}
            </p>
          )}

          {/* Action Bar — 100% Honest Pre-Launch vs Live State */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ps-border)] pt-3.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--ps-text)]">
                <Wallet className="h-3.5 w-3.5 text-theme-primary" />
                <span>DD oodle Escrow Protected</span>
              </span>
              {profile.payment_policy.allow_escrow && (
                <span className="inline-flex items-center gap-1">
                  <span>·</span>
                  <Truck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Pick N Drop Delivery Ready</span>
                </span>
              )}
            </div>

            {isLiveAccepting ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/listing/${encodeURIComponent(listingId)}/print`}
                  data-testid="official-printswift-start-cta"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-[hsl(var(--color-primary-foreground))] shadow-sm transition-opacity hover:opacity-90 active:scale-[0.98]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Start a Print Order</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled
                  data-testid="official-printswift-prelaunch-btn"
                  className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 text-xs font-bold text-amber-800 dark:text-amber-300 opacity-90"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>Pre-Launch Preview — Ordering Opening Soon</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.section>
    );
  }

  // =========================================================================
  // STATE 2: SUBSCRIBED PRINT PRO SHOP
  // =========================================================================
  if (isSubscribedPrintPro && profile) {
    const isAcceptingLive =
      isPrintModuleEnabled && profile.is_accepting_orders && !isBusyPaused;
    const turnaroundMeta = TURNAROUND_BADGE_LABELS[profile.turnaround_badge];
    const verifiedChips = getVerifiedCapabilityChipLabels(profile, false);
    const canCustomDigital = Boolean(
      profile.verified_capabilities.custom_digital_jobs ||
        profile.capabilities.custom_digital_jobs
    );

    const rc = profile.rate_card;
    const rateSummaryItems: Array<{ label: string; value: string }> = [];
    if (typeof rc.bw_a4_single_inr === 'number' && rc.bw_a4_single_inr > 0) {
      rateSummaryItems.push({
        label: 'B&W A4',
        value: `₹${rc.bw_a4_single_inr}/pg`,
      });
    }
    if (
      typeof rc.color_a4_single_inr === 'number' &&
      rc.color_a4_single_inr > 0
    ) {
      rateSummaryItems.push({
        label: 'Color A4',
        value: `₹${rc.color_a4_single_inr}/pg`,
      });
    }
    if (typeof rc.bw_a4_duplex_inr === 'number' && rc.bw_a4_duplex_inr > 0) {
      rateSummaryItems.push({
        label: 'Duplex B&W',
        value: `₹${rc.bw_a4_duplex_inr}/sheet`,
      });
    }
    if (
      typeof rc.spiral_binding_inr === 'number' &&
      rc.spiral_binding_inr > 0
    ) {
      rateSummaryItems.push({
        label: 'Binding',
        value: `₹${rc.spiral_binding_inr}`,
      });
    }
    if (
      typeof rc.lamination_per_sheet_inr === 'number' &&
      rc.lamination_per_sheet_inr > 0
    ) {
      rateSummaryItems.push({
        label: 'Lamination',
        value: `₹${rc.lamination_per_sheet_inr}`,
      });
    }

    const directCap = profile.payment_policy.direct_pay_max_inr;
    const acceptsDirectRail =
      profile.payment_policy.allow_direct_pay && directCap > 0;

    return (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        data-testid="print-service-card-pro"
        className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/12 text-theme-primary">
              <Printer className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Online Print &amp; Digital Counter
                </h2>
                <span className="inline-flex items-center gap-1 rounded-md border border-theme-primary/30 bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-theme-primary">
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>Print Pro</span>
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {isAcceptingLive ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span>Accepting Orders • {turnaroundMeta.label}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <span>Temporarily Paused</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
            <Lock className="h-3 w-3 shrink-0" />
            <span>48h Auto-Delete Privacy</span>
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Verified Capabilities */}
          {verifiedChips.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Verified Capabilities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {verifiedChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)]"
                  >
                    <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{chip}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Transparent Rate Summary */}
          {rateSummaryItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {rateSummaryItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2"
                >
                  <p className="text-[10px] font-medium text-[var(--ps-text-muted)]">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Accepted Payment Rails */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
            {acceptsDirectRail && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 font-medium text-[var(--ps-text)]">
                <IndianRupee className="h-3 w-3 text-theme-primary" />
                <span>
                  Pay at Counter / Shop UPI up to ₹
                  {directCap.toLocaleString('en-IN')}
                </span>
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 font-medium text-[var(--ps-text)]">
              <Wallet className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span>DD oodle Escrow</span>
            </span>
            {profile.payment_policy.allow_escrow && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 font-medium text-[var(--ps-text)]">
                <Truck className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                <span>Pick N Drop Delivery</span>
              </span>
            )}
          </div>

          {/* Primary + Secondary CTAs */}
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ps-border)] pt-3.5">
            {isAcceptingLive ? (
              <>
                <Link
                  href={`/listing/${encodeURIComponent(listingId)}/print`}
                  data-testid="print-pro-order-cta"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-[hsl(var(--color-primary-foreground))] shadow-sm transition-opacity hover:opacity-90 active:scale-[0.98]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Upload &amp; Order Print</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                {canCustomDigital && (
                  <Link
                    href={`/listing/${encodeURIComponent(listingId)}/print?mode=custom_digital`}
                    data-testid="print-pro-custom-digital-cta"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:border-theme-primary hover:text-theme-primary"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Request Custom Digital Job</span>
                  </Link>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 text-xs font-bold text-amber-800 dark:text-amber-300"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Online Print Queue Temporarily Paused</span>
              </button>
            )}
          </div>
        </div>
      </motion.section>
    );
  }

  // =========================================================================
  // STATE 3: FREE BASIC LISTING IN PRINTING & DIGITAL SERVICES
  // Strictly NO file upload or online order CTA.
  // =========================================================================
  const phoneDigits = sanitizeDigits(contactPhone);
  const waDigits = normalizeWhatsAppPhone(whatsappPhone || contactPhone);
  const waHref = waDigits
    ? buildContextualWhatsAppUrl(waDigits, {
        type: 'listing_enquiry',
        listingTitle,
        locality: listingLocality,
        url:
          isHydrated && typeof window !== 'undefined'
            ? `${window.location.origin}/listing/${encodeURIComponent(listingId)}`
            : null,
        customNote:
          'Could you share your current printing & digital rates and availability?',
      })
    : null;

  const provenanceMeta: Record<
    ListingProvenanceTier,
    { label: string; cls: string }
  > = {
    verified: {
      label: 'Verified Directory Listing',
      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
    claimed: {
      label: 'Claimed by Owner',
      cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    },
    submitted: {
      label: 'Submitted Listing',
      cls: 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]',
    },
  };

  const badge = provenanceMeta[provenanceTier];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      data-testid="print-service-card-basic"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 shadow-xs space-y-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]">
            <Store className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Printing &amp; Digital Directory Info
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Walk-in &amp; direct enquiry listing — online file upload not enabled
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
        >
          <ShieldCheck className="h-3 w-3 shrink-0" />
          <span>{badge.label}</span>
        </span>
      </div>

      {/* Provider-claimed services */}
      {providerClaimedServices.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Provider-Claimed Services
          </p>
          <div className="flex flex-wrap gap-1.5">
            {providerClaimedServices.slice(0, 8).map((svc) => (
              <span
                key={svc}
                className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--ps-text)]"
              >
                {svc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Indicative price note */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-1.5 text-[var(--ps-text-muted)]">
          <IndianRupee className="h-3.5 w-3.5 text-theme-primary shrink-0" />
          <span className="font-semibold text-[var(--ps-text)]">
            {indicativePriceNote || 'Contact provider for price'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phoneDigits && (
            <a
              href={`tel:${phoneDigits}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:border-theme-primary hover:text-theme-primary"
            >
              <Phone className="h-3.5 w-3.5 text-theme-primary" />
              <span>Call</span>
            </a>
          )}
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>WhatsApp / Enquire</span>
            </a>
          )}
        </div>
      </div>
    </motion.section>
  );
}
