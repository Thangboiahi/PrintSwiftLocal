'use client';

import React, { useState } from 'react';
import { AdvancedMarker } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, MapPin, Navigation, ShieldCheck, X } from 'lucide-react';
import type { LatLngPoint } from '@/lib/types';

export const GEOLOCATION_PREF_STORAGE_KEY =
  'printswift_local_geolocation_pref_v1';

export function getSavedGeolocationPreference():
  | 'granted'
  | 'denied'
  | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(GEOLOCATION_PREF_STORAGE_KEY);
    if (val === 'granted' || val === 'denied') return val;
    return null;
  } catch {
    return null;
  }
}

export function setSavedGeolocationPreference(
  pref: 'granted' | 'denied' | null
): void {
  if (typeof window === 'undefined') return;
  try {
    if (pref === null) {
      window.localStorage.removeItem(GEOLOCATION_PREF_STORAGE_KEY);
    } else {
      window.localStorage.setItem(GEOLOCATION_PREF_STORAGE_KEY, pref);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export interface GeolocationPromptProps {
  open: boolean;
  onClose: () => void;
  onLocationResolved: (coords: LatLngPoint) => void;
  onLocationError?: (message: string) => void;
}

export function GeolocationPrompt({
  open,
  onClose,
  onLocationResolved,
  onLocationError,
}: GeolocationPromptProps) {
  const [rememberChoice, setRememberChoice] = useState<boolean>(() => {
    return getSavedGeolocationPreference() !== null;
  });
  const [isRequesting, setIsRequesting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleApprove = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      const msg =
        'Geolocation is not supported by your current browser environment.';
      setLocalError(msg);
      onLocationError?.(msg);
      return;
    }

    if (rememberChoice) {
      setSavedGeolocationPreference('granted');
    } else {
      setSavedGeolocationPreference(null);
    }

    setIsRequesting(true);
    setLocalError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsRequesting(false);
        const coords: LatLngPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        onLocationResolved(coords);
        onClose();
      },
      (err) => {
        setIsRequesting(false);
        let msg = 'Unable to determine your current location.';
        if (err.code === 1) {
          msg =
            'Location access was denied. Please enable location permissions in your browser settings.';
        } else if (err.code === 2) {
          msg =
            'Your location is currently unavailable. Please check your GPS or network connection.';
        } else if (err.code === 3) {
          msg = 'Location request timed out. Please try again.';
        }
        setLocalError(msg);
        onLocationError?.(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  const handleDecline = () => {
    if (rememberChoice) {
      setSavedGeolocationPreference('denied');
    }
    setLocalError(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="geolocation-prompt-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="geolocation-prompt-title"
          data-testid="geolocation-prompt-modal"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                  <Navigation className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h2
                    id="geolocation-prompt-title"
                    className="text-sm font-bold text-[var(--ps-text)]"
                  >
                    Find places near me in Lamka
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                     Enable live proximity &amp; turn-by-turn routing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close location permission prompt"
                data-testid="geolocation-prompt-close-btn"
                className="rounded-lg p-1.5 text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface)] hover:text-[var(--ps-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 p-5 text-xs">
              <p className="leading-relaxed text-[var(--ps-text-muted)]">
                Allow <strong className="text-[var(--ps-text)]">PrintSwift Local</strong> to access your device&apos;s GPS coordinates to place a live{' '}
                <span className="font-semibold text-sky-600 dark:text-sky-400">
                  &ldquo;You Are Here&rdquo;
                </span>{' '}
                marker on the map and calculate shortest-path driving directions to listings across Churachandpur.
              </p>

              <div className="flex items-start gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-[11px] text-[var(--ps-text-muted)]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Your coordinates are processed strictly inside your browser session and are never transmitted to third-party servers.
                </span>
              </div>

              {localError && (
                <div
                  role="alert"
                  data-testid="geolocation-prompt-error"
                  className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                >
                  {localError}
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2.5 select-none pt-1">
                <input
                  type="checkbox"
                  checked={rememberChoice}
                  onChange={(e) => setRememberChoice(e.target.checked)}
                  data-testid="geolocation-remember-checkbox"
                  className="h-4 w-4 rounded border-[var(--ps-border)] text-sky-600 focus:ring-sky-500"
                />
                <span className="text-xs font-medium text-[var(--ps-text)]">
                  Remember my choice on this device
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-5 py-3.5">
              <button
                type="button"
                onClick={handleDecline}
                disabled={isRequesting}
                data-testid="geolocation-decline-btn"
                className="min-h-[40px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)] transition hover:text-[var(--ps-text)] disabled:opacity-50"
              >
                Not Now
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={isRequesting}
                data-testid="geolocation-approve-btn"
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRequesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Locating...</span>
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4" />
                    <span>Allow Location Access</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Distinct, pulsing "You Are Here" blue dot marker rendered on the Google Map at the user's coordinates.
 */
export function YouAreHereMarker({ position }: { position: LatLngPoint }) {
  return (
    <AdvancedMarker position={position} zIndex={1200}>
      <div
        data-testid="you-are-here-marker"
        title={`You Are Here (${position.lat.toFixed(4)}°, ${position.lng.toFixed(4)}°)`}
        aria-label="You Are Here"
        className="relative flex items-center justify-center"
      >
        <span className="absolute h-9 w-9 animate-ping rounded-full bg-sky-400/60" />
        <span className="absolute h-6 w-6 rounded-full bg-sky-500/25" />
        <span className="relative h-4 w-4 rounded-full border-2 border-white bg-sky-600 shadow-lg ring-2 ring-sky-500/50" />
        <span className="pointer-events-none absolute -top-7 rounded-md bg-slate-900/95 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-white shadow-md">
          You Are Here
        </span>
      </div>
    </AdvancedMarker>
  );
}

export default GeolocationPrompt;
