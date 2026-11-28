'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useHydrated } from '@/hooks/useHydrated';
import { Check, Copy, Printer, QrCode, X } from 'lucide-react';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import { InlineQrCode } from '@/components/ui/InlineQrCode';

export interface CommerceQrPosterModalProps {
  open: boolean;
  onClose: () => void;
  listingId: string;
  listingTitle: string;
  listingLocality?: string | null;
  mode: 'restaurant_food' | 'shop_catalogue';
}

/**
 * Printable A5/A4 Storefront & Table QR Menu Poster Modal (z-[90]).
 * Reuses InlineQrCode + DDoodleLogo with zero external QR packages.
 */
export function CommerceQrPosterModal({
  open,
  onClose,
  listingId,
  listingTitle,
  listingLocality,
  mode,
}: CommerceQrPosterModalProps) {
  const isHydrated = useHydrated();
  const [copied, setCopied] = useState(false);

  if (!open || !isHydrated || typeof document === 'undefined') return null;

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://ddoodle.in';
  const targetUrl = `${origin}/listing/${encodeURIComponent(listingId)}`;

  const isRestaurant = mode === 'restaurant_food';
  const headline = isRestaurant
    ? 'Scan for Live Menu & Order — 0% Commission on DD oodle'
    : 'Scan to Browse Our Live Catalogue & Order Delivery';
  const subline = isRestaurant
    ? 'Fresh Takeaway, Pick N Drop Hot-Food Delivery & Instant Table Reservations'
    : 'Check Live In-Stock Items, Counter Pickup & Doorstep Pick N Drop Delivery';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Printable Storefront QR Poster"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header (hidden in print) */}
        <div className="flex items-center justify-between border-b border-[var(--ps-border)] px-4 py-3 print:hidden">
          <div className="flex items-center gap-2">
            <QrCode
              className={`h-4 w-4 ${
                isRestaurant ? 'text-orange-600' : 'text-sky-600'
              }`}
            />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              {isRestaurant ? 'Table QR Menu Poster' : 'Storefront QR Poster'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR poster"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Printable Poster Card */}
        <div className="p-5">
          <div
            className={`rounded-2xl border-2 bg-white p-6 text-center text-slate-900 shadow-sm ${
              isRestaurant ? 'border-orange-500/70' : 'border-sky-500/70'
            }`}
          >
            <div className="flex justify-center">
              <DDoodleLogo variant="full" />
            </div>

            <div className="mt-4 space-y-1">
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                  isRestaurant
                    ? 'bg-orange-100 text-orange-800'
                    : 'bg-sky-100 text-sky-800'
                }`}
              >
                {isRestaurant ? 'Digital Menu & Table Ordering' : 'Live Local Storefront'}
              </span>
              <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
                {listingTitle}
              </h2>
              {listingLocality && (
                <p className="text-xs font-medium text-slate-500">
                  {listingLocality}
                </p>
              )}
            </div>

            <div className="my-4 flex justify-center">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
                <InlineQrCode
                  value={targetUrl}
                  size={200}
                  darkColor="#0f172a"
                  lightColor="#ffffff"
                  label={`QR code for ${listingTitle}`}
                />
              </div>
            </div>

            <p className="text-sm font-extrabold leading-snug text-slate-900">
              {headline}
            </p>
            <p className="mt-1 text-[11px] text-slate-600">{subline}</p>

            <p className="mt-3 break-all rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-[10px] text-slate-600">
              {targetUrl}
            </p>
          </div>
        </div>

        {/* Modal Footer Actions (hidden in print) */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-3 print:hidden">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span>Copied Link</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy Link</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white shadow-xs cursor-pointer ${
              isRestaurant
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
