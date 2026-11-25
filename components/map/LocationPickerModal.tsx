'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Compass, Loader2, X } from 'lucide-react';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { CHURACHANDPUR_FALLBACK_CENTER, normalizeLatLng } from '@/lib/maps/coordinates';
import {
  STORAGE_KEY_MAP_PROMPT_DISMISSED,
  type MapSettings,
} from '@/lib/map-settings';
import {
  STORAGE_KEY_CUSTOM_DEFAULT_CENTER,
  useAppStore,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { LatLngPoint } from '@/lib/types';

export interface LocationPickerModalProps {
  open: boolean;
  onClose: () => void;
  initialCenter?: LatLngPoint;
  initialZoom?: number;
  onSaved?: (settings: MapSettings) => void;
}

function LocationPickerDialogBody({
  onClose,
  initialCenter,
  initialZoom,
  onSaved,
}: Omit<LocationPickerModalProps, 'open'>) {
  const {
    effectiveDefaultCenter,
    customDefaultZoom,
    setCustomDefaultCenter,
  } = useAppStore();

  const startCenter = normalizeLatLng(
    initialCenter || effectiveDefaultCenter,
    CHURACHANDPUR_FALLBACK_CENTER
  );
  const startZoom =
    typeof initialZoom === 'number' && Number.isFinite(initialZoom)
      ? Math.min(20, Math.max(3, Math.round(initialZoom)))
      : customDefaultZoom || 13;

  const [pickedCenter, setPickedCenter] = useState<LatLngPoint>(startCenter);
  const [pickedZoom, setPickedZoom] = useState<number>(startZoom);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !isSaving) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, onClose]);

  const handleSaveDefaultLocation = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);

    const payload: MapSettings = {
      lat: Number(pickedCenter.lat.toFixed(6)),
      lng: Number(pickedCenter.lng.toFixed(6)),
      zoom: Math.min(20, Math.max(3, Math.round(pickedZoom))),
      configured: true,
    };

    try {
      let accessToken: string | undefined;
      if (isSupabaseConfigured()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          accessToken = session?.access_token;
        } catch {
          // Proceed cleanly with cookie persistence fallback
        }
      }

      const res = await fetch('/api/profile/update-map-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || 'Failed to save default map location.');
      }

      setCustomDefaultCenter({ lat: payload.lat, lng: payload.lng }, payload.zoom);

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            STORAGE_KEY_CUSTOM_DEFAULT_CENTER,
            JSON.stringify(payload)
          );
          window.localStorage.setItem(STORAGE_KEY_MAP_PROMPT_DISMISSED, '1');
          window.dispatchEvent(
            new CustomEvent('printswift:map-settings-updated', {
              detail: payload,
            })
          );
        } catch {
          // ignore storage errors
        }
      }

      onSaved?.(payload);
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Could not save default map location.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      key="location-picker-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="location-picker-modal-backdrop"
      onClick={() => {
        if (!isSaving) onClose();
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-sm"
    >
      <motion.div
        key="location-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-modal-title"
        data-testid="location-picker-modal"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs">
              <Compass className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="location-picker-modal-title"
                className="truncate text-base font-bold text-[var(--ps-text)]"
              >
                Set Default Map Location
              </h2>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Pan under the centered crosshair or use high-accuracy GPS
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            aria-label="Close location picker"
            data-testid="location-picker-close-btn"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--ps-text-muted)] transition-colors hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Unified Map Coordinate Picker Body */}
        <div className="flex-1 space-y-3.5 overflow-y-auto p-4 sm:p-5">
          <MapCoordinatePicker
            mode="point"
            coordinates={pickedCenter}
            onChangeCoordinates={setPickedCenter}
            zoom={pickedZoom}
            onChangeZoom={setPickedZoom}
            showZoomControl={true}
            allowExpand={false}
            helperText="Pan & zoom so the crosshair tip rests over your preferred home area."
          />

          {saveError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400"
            >
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveDefaultLocation()}
              data-testid="location-picker-save-btn"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 py-2 text-xs font-bold text-[var(--btn-primary-fg)] shadow-xs transition-opacity hover:opacity-95 disabled:opacity-60 cursor-pointer"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>{isSaving ? 'Saving…' : 'Save Default Location'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function LocationPickerModal({
  open,
  onClose,
  initialCenter,
  initialZoom,
  onSaved,
}: LocationPickerModalProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <LocationPickerDialogBody
          onClose={onClose}
          initialCenter={initialCenter}
          initialZoom={initialZoom}
          onSaved={onSaved}
        />
      )}
    </AnimatePresence>,
    document.body
  );
}
