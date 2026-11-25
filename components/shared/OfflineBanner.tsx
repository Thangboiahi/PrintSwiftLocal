'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Download,
  KeyRound,
  Phone,
  PlusSquare,
  Share,
  WifiOff,
  X,
} from 'lucide-react';
import { auditPublicEnv } from '@/lib/env';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const IOS_INSTALL_DISMISSED_KEY = 'ddoodle_ios_install_dismissed_v1';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState<boolean>(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState<boolean>(false);
  const [iosGuideOpen, setIosGuideOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Phase 44: Non-fatal runtime audit of NEXT_PUBLIC_* configuration
    auditPublicEnv();

    let cancelled = false;
    const syncOnlineStatus = () => {
      if (!cancelled) {
        setIsOffline(window.navigator.onLine === false);
      }
    };

    void Promise.resolve().then(() => {
      if (cancelled) return;
      syncOnlineStatus();

      // Detect iOS Safari (no beforeinstallprompt) when not already installed in standalone mode
      const ua = window.navigator.userAgent || '';
      const isIosDevice = /iPad|iPhone|iPod/i.test(ua);
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone ===
          true;
      const previouslyDismissed =
        window.localStorage.getItem(IOS_INSTALL_DISMISSED_KEY) === '1';

      if (isIosDevice && !isStandalone && !previouslyDismissed) {
        setShowIosInstallHint(true);
      }
    });

    window.addEventListener('online', syncOnlineStatus);
    window.addEventListener('offline', syncOnlineStatus);

    if ('serviceWorker' in window.navigator) {
      window.navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore service worker registration errors in restricted preview frames
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (!cancelled) {
        setDeferredInstallPrompt(e as BeforeInstallPromptEvent);
      }
    };

    const handleAppInstalled = () => {
      if (!cancelled) {
        setDeferredInstallPrompt(null);
        setShowIosInstallHint(false);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      cancelled = true;
      window.removeEventListener('online', syncOnlineStatus);
      window.removeEventListener('offline', syncOnlineStatus);
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredInstallPrompt(null);
    }
  };

  const handleDismissIos = () => {
    setShowIosInstallHint(false);
    setIosGuideOpen(false);
    try {
      window.localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, '1');
    } catch {
      // ignore storage errors
    }
  };

  const shouldRenderInstallBanner =
    !isOffline &&
    !installDismissed &&
    (Boolean(deferredInstallPrompt) || showIosInstallHint);

  if (!isOffline && !shouldRenderInstallBanner && !iosGuideOpen) {
    return null;
  }

  return (
    <>
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          data-testid="offline-status-banner"
          className="relative w-full shrink-0 bg-amber-500/95 backdrop-blur-xs text-slate-950 border-b border-amber-600/30 px-3 sm:px-5 py-2 text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="leading-snug">
              Offline Mode — Browsing cached Churachandpur helplines &amp; active booking OTPs.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Link
              href="/civic"
              className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg bg-slate-950 text-white text-[11px] font-bold hover:bg-slate-900 transition-colors"
            >
              <Phone className="w-3.5 h-3.5" aria-hidden="true" />
              <span>24×7 Helplines</span>
            </Link>
            <Link
              href="/profile#offline-otps"
              className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg bg-white/90 text-slate-950 text-[11px] font-bold border border-slate-950/15 hover:bg-white transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Booking OTPs</span>
            </Link>
          </div>
        </div>
      )}

      {shouldRenderInstallBanner && (
        <div
          role="region"
          aria-label="Install DD oodle App"
          data-testid="pwa-install-banner"
          className="w-full bg-[var(--ps-surface-alt)] text-[var(--ps-text)] border-b border-[var(--ps-border)] px-3 sm:px-5 py-1.5 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Download
              className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0"
              aria-hidden="true"
            />
            <span className="truncate font-medium">
              Install DD oodle for quick access to 24×7 helplines and offline booking OTPs.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {deferredInstallPrompt ? (
              <button
                type="button"
                onClick={handleInstallClick}
                className="min-h-[36px] px-3 py-1 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-semibold hover:opacity-95 transition-opacity cursor-pointer"
              >
                Install
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIosGuideOpen(true)}
                className="min-h-[36px] px-3 py-1 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-semibold hover:opacity-95 transition-opacity cursor-pointer"
              >
                Add to Home Screen
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setInstallDismissed(true);
                if (showIosInstallHint) handleDismissIos();
              }}
              aria-label="Dismiss install banner"
              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {iosGuideOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install DD oodle on iOS"
          className="fixed inset-0 z-[9995] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          onClick={() => setIosGuideOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Install DD oodle on iPhone / iPad
                </h3>
                <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                  Keep Churachandpur 24×7 emergency helplines &amp; active OTPs ready offline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIosGuideOpen(false)}
                aria-label="Close iOS install instructions"
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="space-y-2.5 text-xs text-[var(--ps-text)]">
              <li className="flex items-start gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                <Share className="w-4 h-4 text-[var(--ps-accent)] shrink-0 mt-0.5" />
                <span>
                  1. Tap the <strong>Share</strong> button in Safari&apos;s bottom toolbar.
                </span>
              </li>
              <li className="flex items-start gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                <PlusSquare className="w-4 h-4 text-[var(--ps-accent)] shrink-0 mt-0.5" />
                <span>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={handleDismissIos}
              className="w-full min-h-[44px] rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold hover:opacity-95 transition-opacity"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default OfflineBanner;
