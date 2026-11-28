'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Image from 'next/image';
import { useHydrated } from '@/hooks/useHydrated';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  MessageCircle,
  MessageSquare,
  QrCode,
  Share2,
  Star,
  X,
} from 'lucide-react';
import { useModalLock } from '@/hooks/useModalLock';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { InlineQrCode } from '@/components/ui/InlineQrCode';
import { buildWhatsAppUrl } from '@/lib/utils/whatsapp';
import { trackAppEvent } from '@/lib/analytics/track';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import {
  canUseNativeShare,
  normalizeSharePayload,
  SHARE_SHEET_OPEN_EVENT,
  shareContent,
  triggerNativeShare,
  type ResolvedSharePayload,
  type ShareOutcome,
  type SharePayload,
} from '@/lib/utils/share';

export interface ShareSheetModalProps {
  isOpen: boolean;
  payload: ResolvedSharePayload | null;
  onClose: () => void;
}

export function ShareSheetModal({
  isOpen,
  payload,
  onClose,
}: ShareSheetModalProps) {
  const mounted = useHydrated();
  const { setStatus } = useAppStatus();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleClose = useCallback(() => {
    setCopied(false);
    setShowQr(false);
    setImgError(false);
    onClose();
  }, [onClose]);

  useModalLock(isOpen, handleClose);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  const handleCopyLink = useCallback(async () => {
    if (!payload) return;
    const textToCopy = payload.url || payload.text || payload.title;
    if (!textToCopy) return;

    let didCopy = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        didCopy = true;
      }
    } catch {
      // Fallback below
    }

    if (!didCopy && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        didCopy = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        didCopy = false;
      }
    }

    if (didCopy) {
      setCopied(true);
      setStatus('success', 'Link copied to clipboard');
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setStatus('error', 'Could not copy link');
    }
  }, [payload, setStatus]);

  const handleNativeShare = useCallback(async () => {
    if (!payload) return;
    const res = await triggerNativeShare(payload);
    if (res.ok && res.method === 'native') {
      handleClose();
    } else if (!res.ok) {
      await handleCopyLink();
    }
  }, [payload, handleClose, handleCopyLink]);

  if (!mounted) return null;

  const whatsappHref = payload
    ? buildWhatsAppUrl('', payload.whatsappMessage)
    : 'https://wa.me/';
  const smsBody = payload
    ? [payload.title, payload.text, payload.url].filter(Boolean).join(' — ')
    : '';
  const smsHref = `sms:?body=${encodeURIComponent(smsBody)}`;
  const qrValue = payload?.url || payload?.text || payload?.title || '';
  const supportsNative = canUseNativeShare();
  const badgeText = payload?.verticalBadge || payload?.categoryLabel || 'DD oodle';
  const hasValidImage = Boolean(payload?.imageUrl && !imgError);
  const titleInitials = (payload?.title || 'DD')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  return createPortal(
    <AnimatePresence>
      {isOpen && payload && (
        <div
          className="fixed inset-0 z-[92] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-sheet-modal-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={handleClose}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full sm:max-w-md max-h-[88vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-accent)]/25 bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]">
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="share-sheet-modal-title"
                    className="truncate text-sm font-bold text-[var(--ps-text)]"
                  >
                    Share Card
                  </h3>
                  <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                    Send via WhatsApp, copy link, or scan QR
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                aria-label="Close share sheet"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-[var(--ps-text-muted)] transition-colors hover:border-[var(--ps-border)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Rich Visual Share Preview Card */}
            <div className="px-5 pt-4">
              <div
                data-testid="share-preview-card"
                className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] shadow-xs"
              >
                <div className="flex items-stretch gap-3.5 p-3.5">
                  {/* Cover Thumbnail or Stylized Monogram */}
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                    {hasValidImage && payload.imageUrl ? (
                      <Image
                        loader={supabaseMediaImageLoader}
                        src={payload.imageUrl}
                        alt={payload.title}
                        fill
                        sizes="80px"
                        referrerPolicy="no-referrer"
                        onError={() => setImgError(true)}
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[var(--ps-accent)]/15 to-[var(--ps-accent)]/5 text-[var(--ps-accent)]">
                        <span className="text-base font-black tracking-tight">
                          {titleInitials || 'DD'}
                        </span>
                        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider opacity-75">
                          DD oodle
                        </span>
                      </div>
                    )}
                    {payload.isVerified && (
                      <span
                        title="Verified on DD oodle"
                        className="absolute bottom-1 right-1 inline-flex items-center justify-center rounded-full bg-emerald-600 p-0.5 text-white shadow-xs"
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>

                  {/* Card Details */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-md bg-[var(--ps-accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                          {badgeText}
                        </span>
                        {payload.isVerified && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                            <BadgeCheck className="h-3 w-3" /> Verified
                          </span>
                        )}
                        {typeof payload.rating === 'number' && payload.rating > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                            {payload.rating.toFixed(1)}
                          </span>
                        )}
                      </div>

                      <h4 className="mt-1 line-clamp-1 text-sm font-bold text-[var(--ps-text)]">
                        {payload.title}
                      </h4>

                      {payload.locality && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--ps-text-muted)]">
                          <MapPin className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                          <span className="truncate">{payload.locality}</span>
                        </p>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      {payload.priceLabel ? (
                        <span className="inline-flex items-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                          {payload.priceLabel}
                        </span>
                      ) : payload.subtitle ? (
                        <span className="truncate text-[11px] font-medium text-[var(--ps-text-muted)]">
                          {payload.subtitle}
                        </span>
                      ) : (
                        <span className="truncate text-[11px] text-[var(--ps-text-muted)]">
                          Churachandpur Super-App
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* URL Footer Strip */}
                {(payload.text || payload.url) && (
                  <div className="border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/70 px-3.5 py-2">
                    {payload.text && (
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--ps-text-muted)]">
                        {payload.text}
                      </p>
                    )}
                    {payload.url && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--ps-text-muted)]/80">
                        {payload.url}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Primary 1-Tap Action Row: WhatsApp & Copy Link */}
            <div className="grid grid-cols-2 gap-2.5 px-5 pt-4">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackAppEvent({
                    event_type: 'whatsapp_click',
                    feature_area: 'share',
                    target_id: payload.title?.slice(0, 80) || 'whatsapp_share',
                  });
                  handleClose();
                }}
                className="flex min-h-[44px] h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>WhatsApp Share</span>
              </a>

              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="flex min-h-[44px] h-11 items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-bold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-bg)] cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-300">
                      Copied!
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
            </div>

            {/* Secondary Action Grid: Native Web Share, SMS, QR Code */}
            <div className={`grid ${supportsNative ? 'grid-cols-3' : 'grid-cols-2'} gap-2.5 p-5 pt-2.5`}>
              {supportsNative && (
                <button
                  type="button"
                  onClick={() => void handleNativeShare()}
                  className="flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-bg)] cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                  <span className="truncate">More Apps</span>
                </button>
              )}

              <a
                href={smsHref}
                onClick={handleClose}
                className="flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-bg)]"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                <span className="truncate">SMS</span>
              </a>

              <button
                type="button"
                onClick={() => setShowQr((prev) => !prev)}
                className={`flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                  showQr
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-bg)]'
                }`}
              >
                <QrCode className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{showQr ? 'Hide QR' : 'QR Code'}</span>
              </button>
            </div>

            {/* Inline QR Code Drawer */}
            <AnimatePresence initial={false}>
              {showQr && qrValue && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/55"
                >
                  <div className="flex flex-col items-center justify-center gap-2.5 px-5 py-4 text-center">
                    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
                      <InlineQrCode
                        value={qrValue}
                        size={176}
                        label={`QR code for ${payload.title}`}
                      />
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      Scan with any phone camera to open directly on DD oodle
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export interface ShareContextValue {
  share: (
    payload: SharePayload,
    options?: { forceFallback?: boolean }
  ) => Promise<{ ok: boolean; method: ShareOutcome }>;
  openShareSheet: (payload: SharePayload) => void;
  closeShareSheet: () => void;
}

const ShareContext = createContext<ShareContextValue>({
  share: (payload, options) => shareContent(payload, options),
  openShareSheet: (payload) => {
    void shareContent(payload, { forceFallback: true });
  },
  closeShareSheet: () => {},
});

export function ShareProvider({ children }: { children: React.ReactNode }) {
  const [activePayload, setActivePayload] =
    useState<ResolvedSharePayload | null>(null);

  const openShareSheet = useCallback((payload: SharePayload) => {
    setActivePayload(normalizeSharePayload(payload));
  }, []);

  const closeShareSheet = useCallback(() => {
    setActivePayload(null);
  }, []);

  const share = useCallback(
    async (
      payload: SharePayload,
      options?: { forceFallback?: boolean }
    ): Promise<{ ok: boolean; method: ShareOutcome }> => {
      return shareContent(payload, {
        forceFallback: options?.forceFallback,
        onFallback: (resolved) => {
          setActivePayload(resolved);
        },
      });
    },
    []
  );

  // Listen for imperative `shareContent(...)` calls from anywhere in the app
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpenEvent = (event: Event) => {
      const detail = (event as CustomEvent<ResolvedSharePayload>).detail;
      if (detail) {
        setActivePayload(detail);
      }
    };
    window.addEventListener(SHARE_SHEET_OPEN_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener(SHARE_SHEET_OPEN_EVENT, handleOpenEvent);
    };
  }, []);

  const value = useMemo<ShareContextValue>(
    () => ({
      share,
      openShareSheet,
      closeShareSheet,
    }),
    [share, openShareSheet, closeShareSheet]
  );

  return (
    <ShareContext.Provider value={value}>
      {children}
      <ShareSheetModal
        isOpen={Boolean(activePayload)}
        payload={activePayload}
        onClose={closeShareSheet}
      />
    </ShareContext.Provider>
  );
}

export function useShare(): ShareContextValue {
  return useContext(ShareContext);
}
