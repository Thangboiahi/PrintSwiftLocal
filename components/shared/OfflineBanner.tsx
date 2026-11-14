'use client';

import React, { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncOnlineStatus = () => {
      setIsOffline(window.navigator.onLine === false);
    };

    syncOnlineStatus();
    window.addEventListener('online', syncOnlineStatus);
    window.addEventListener('offline', syncOnlineStatus);

    if ('serviceWorker' in window.navigator) {
      window.navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore service worker registration errors in restricted preview frames
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
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

  if (!isOffline && (!deferredInstallPrompt || installDismissed)) {
    return null;
  }

  return (
    <>
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          data-testid="offline-status-banner"
          className="sticky top-0 z-50 w-full bg-amber-500/95 backdrop-blur-xs text-slate-950 border-b border-amber-600/30 px-3 sm:px-5 py-2 text-xs font-semibold flex items-center justify-center gap-2 shadow-xs"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            You are currently offline — browsing cached Churachandpur directory
            data. Changes will sync when your connection returns.
          </span>
        </div>
      )}

      {!isOffline && deferredInstallPrompt && !installDismissed && (
        <div
          role="region"
          aria-label="Install PrintSwift Local App"
          data-testid="pwa-install-banner"
          className="w-full bg-[var(--ps-surface-alt)] text-[var(--ps-text)] border-b border-[var(--ps-border)] px-3 sm:px-5 py-1.5 text-xs flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Download
              className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0"
              aria-hidden="true"
            />
            <span className="truncate font-medium">
              Install PrintSwift Local for quick home-screen access and offline
              browsing.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleInstallClick}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-semibold hover:opacity-95 transition-opacity"
            >
              Install
            </button>
            <button
              type="button"
              onClick={() => setInstallDismissed(true)}
              aria-label="Dismiss install banner"
              className="p-1 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default OfflineBanner;
