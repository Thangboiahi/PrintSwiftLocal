'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import {
  Check,
  Copy,
  ExternalLink,
  Printer,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import { InlineQrCode } from '@/components/ui/InlineQrCode';

export interface CounterQrPosterModalProps {
  open: boolean;
  onClose: () => void;
  listingId: string;
  shopName: string;
  locality?: string;
  isFirstPartyPrintSwift?: boolean;
  turnaroundLabel?: string;
}

export function CounterQrPosterModal({
  open,
  onClose,
  listingId,
  shopName,
  locality,
  isFirstPartyPrintSwift = false,
  turnaroundLabel,
}: CounterQrPosterModalProps) {
  const isHydrated = useHydrated();
  const [copied, setCopied] = useState(false);

  const origin =
    isHydrated && typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://ddoodle.in';

  const printUrl = `${origin}/listing/${encodeURIComponent(listingId)}/print`;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(printUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handlePrintPoster = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  if (!isHydrated || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          data-testid="counter-qr-poster-modal"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto print:static print:inset-auto print:bg-white print:p-0 print:backdrop-blur-none"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Counter QR Poster for ${shopName}`}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-2xl overflow-hidden print:max-w-none print:rounded-none print:border-0 print:shadow-none print:bg-white"
          >
            {/* Modal Action Bar (hidden when printing) */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 print:hidden">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  Printable Counter QR Poster (A5 / A4)
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Place on your print counter so walk-in customers can upload files without WhatsApp clutter.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Counter QR Poster"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Printable A5 / A4 Poster Canvas */}
            <div className="p-4 sm:p-6 bg-slate-100/80 dark:bg-slate-900/70 print:bg-white print:p-0">
              <div
                id="ddoodle-printable-counter-poster"
                className="mx-auto max-w-[420px] rounded-2xl border-2 border-slate-900/15 bg-white text-slate-900 p-6 sm:p-7 shadow-sm print:max-w-[148mm] print:min-h-[195mm] print:flex print:flex-col print:justify-between print:border print:border-slate-300 print:shadow-none"
              >
                {/* Brand Lockup Header */}
                <div className="flex flex-col items-center text-center border-b border-slate-200 pb-4">
                  <DDoodleLogo variant="full" size={34} />
                  <p className="mt-2.5 text-[11px] font-bold uppercase tracking-widest text-[#0E4447]">
                    {isFirstPartyPrintSwift
                      ? 'Official DD oodle Print Counter'
                      : 'Verified Print & Digital Counter'}
                  </p>
                  <h3 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 text-balance">
                    {shopName}
                  </h3>
                  {(locality || turnaroundLabel) && (
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      {[locality, turnaroundLabel].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>

                {/* Center QR Block */}
                <div className="my-5 flex flex-col items-center text-center">
                  <div className="rounded-2xl border-2 border-[#0E4447]/20 bg-white p-3.5 shadow-xs">
                    <InlineQrCode
                      value={printUrl}
                      size={212}
                      margin={2}
                      darkColor="#0f172a"
                      lightColor="#ffffff"
                      label={`Print counter QR code for ${shopName}`}
                    />
                  </div>

                  <p className="mt-4 text-sm font-extrabold text-slate-900 text-balance">
                    Scan to Upload PDFs &amp; Photos — Auto-Deletes in 48h
                  </p>
                  <p className="mt-1 text-xs text-slate-600 max-w-xs">
                    No WhatsApp number sharing needed. Instant page count, clear rates &amp; 4-digit pickup OTP.
                  </p>
                </div>

                {/* 3-Step Counter Instructions */}
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                  <div>
                    <p className="font-mono text-xs font-extrabold text-[#0E4447]">
                      01
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-800">
                      Scan QR
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xs font-extrabold text-[#0E4447]">
                      02
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-800">
                      Upload PDF/Photos
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xs font-extrabold text-[#0E4447]">
                      03
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-800">
                      Show 4-Digit OTP
                    </p>
                  </div>
                </div>

                {/* Privacy Footer & URL */}
                <div className="mt-4 pt-3 border-t border-slate-200 flex flex-col items-center gap-1.5 text-center">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span>Private Vault • Files permanently purged 48h after pickup</span>
                  </div>
                  <p className="font-mono text-[10px] text-slate-500 break-all">
                    {printUrl}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer Actions (hidden when printing) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 print:hidden">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Print URL</span>
                    </>
                  )}
                </button>
                <a
                  href={printUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>Preview</span>
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </a>
              </div>

              <button
                type="button"
                onClick={handlePrintPoster}
                data-testid="print-counter-poster-btn"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print / Save PDF</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default CounterQrPosterModal;
