'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import {
  Check,
  Compass,
  Crosshair,
  Loader2,
  MapPin,
  Navigation,
  X,
} from 'lucide-react';
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import { resolveCloudMapConfiguration } from '@/lib/map-cloud-styles';
import {
  STORAGE_KEY_MAP_PROMPT_DISMISSED,
  type MapSettings,
} from '@/lib/map-settings';
import { useMapsAvailability } from '@/lib/maps-context';
import { useSettings } from '@/lib/hooks/useSettings';
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

function MiniMapPanController({
  panRequest,
}: {
  panRequest: { center: LatLngPoint; zoom: number; seq: number } | null;
}) {
  const map = useMap('location-picker-mini-map');
  const lastSeqRef = useRef<number>(0);

  useEffect(() => {
    if (!map || !panRequest || panRequest.seq === lastSeqRef.current) return;
    lastSeqRef.current = panRequest.seq;
    map.panTo(panRequest.center);
    map.setZoom(panRequest.zoom);
  }, [map, panRequest]);

  return null;
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
    mapStyle,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    useVectorStylePreview,
  } = useAppStore();
  const { updateDefaultMapLocation } = useSettings();
  const { apiKeyAvailable } = useMapsAvailability();

  const startCenter = initialCenter || effectiveDefaultCenter;
  const startZoom =
    typeof initialZoom === 'number' && Number.isFinite(initialZoom)
      ? Math.min(20, Math.max(3, Math.round(initialZoom)))
      : customDefaultZoom || 13;

  const [pickedCenter, setPickedCenter] = useState<LatLngPoint>(startCenter);
  const [pickedZoom, setPickedZoom] = useState<number>(startZoom);
  const [panRequest, setPanRequest] = useState<{
    center: LatLngPoint;
    zoom: number;
    seq: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoSuccessToast, setGeoSuccessToast] = useState<string | null>(null);
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

  const resolvedCloudConfig = useMemo(
    () =>
      resolveCloudMapConfiguration({
        mapStyle,
        mapAppearance,
        configuredMapId,
        configuredLightMapId,
        configuredDarkMapId,
      }),
    [
      mapStyle,
      mapAppearance,
      configuredMapId,
      configuredLightMapId,
      configuredDarkMapId,
    ]
  );

  const handleUseCurrentLocation = () => {
    setGeoError(null);
    setGeoSuccessToast(null);
    if (
      typeof navigator === 'undefined' ||
      !('geolocation' in navigator)
    ) {
      setGeoError('Geolocation is not supported in this browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCenter: LatLngPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        const nextZoom = Math.max(pickedZoom, 15);
        setPickedCenter(nextCenter);
        setPickedZoom(nextZoom);
        setPanRequest({
          center: nextCenter,
          zoom: nextZoom,
          seq: Date.now() + Math.random(),
        });
        setIsLocating(false);
        setGeoSuccessToast(
          `GPS location locked (${nextCenter.lat.toFixed(4)}, ${nextCenter.lng.toFixed(4)}) and saved as default center.`
        );
        void updateDefaultMapLocation(nextCenter, nextZoom).then((saved) => {
          onSaved?.(saved);
        });
      },
      (err) => {
        const isPermissionDenied =
          err.code === 1 ||
          /denied|permission/i.test(err.message || '');
        setGeoError(
          isPermissionDenied
            ? 'Location permission denied. Please enable location permissions in your browser settings or drag the map manually.'
            : err.message ||
                'Unable to access your current location. Drag the map manually instead.'
        );
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

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
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        key="location-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-modal-title"
        data-testid="location-picker-modal"
        initial={{ opacity: 0, y: 32, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[calc(100vw-32px)] max-w-md max-h-[85dvh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 text-[var(--ps-text)]"
      >
        {/* Header */}
        <div className="shrink-0 sticky top-0 z-10 bg-white dark:bg-slate-900 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Compass className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h2
                id="location-picker-modal-title"
                className="text-base font-bold text-[var(--ps-text)] truncate"
              >
                Set Default Map Location
              </h2>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Pan &amp; zoom the map so the crosshair aligns over your home area
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            aria-label="Close location picker"
            data-testid="location-picker-close-btn"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Interactive Mini-Map Viewport + Fixed Center Crosshair */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
          <div
            data-testid="location-picker-map-viewport"
            className="relative h-60 sm:h-72 shrink-0 w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800"
            style={{ backgroundColor: resolvedCloudConfig.backgroundColor }}
          >
            {apiKeyAvailable && !useVectorStylePreview ? (
              <GoogleMap
                key={`picker-gmap-${resolvedCloudConfig.mapId}-${resolvedCloudConfig.colorScheme}`}
                id="location-picker-mini-map"
                mapId={resolvedCloudConfig.mapId}
                defaultCenter={pickedCenter}
                defaultZoom={pickedZoom}
                mapTypeId={resolvedCloudConfig.mapTypeId}
                colorScheme={resolvedCloudConfig.colorScheme}
                backgroundColor={resolvedCloudConfig.backgroundColor}
                gestureHandling="greedy"
                disableDefaultUI={true}
                zoomControl={true}
                clickableIcons={false}
                keyboardShortcuts={true}
                controlSize={28}
                internalUsageAttributionIds={[
                  'gmp_mcp_codeassist_v1_aistudio',
                  'gmp_git_agentskills_v1',
                ]}
                onCameraChanged={(ev) => {
                  if (ev.detail.center) {
                    setPickedCenter({
                      lat: Number(ev.detail.center.lat.toFixed(6)),
                      lng: Number(ev.detail.center.lng.toFixed(6)),
                    });
                  }
                  if (typeof ev.detail.zoom === 'number') {
                    setPickedZoom(
                      Math.min(20, Math.max(3, Math.round(ev.detail.zoom)))
                    );
                  }
                }}
                className="w-full h-full"
              >
                <MiniMapPanController panRequest={panRequest} />
              </GoogleMap>
            ) : (
              <InteractiveVectorMap
                listings={[]}
                selectedListing={null}
                onSelectListing={() => {}}
                mapStyle={mapStyle}
                mapAppearance={resolvedCloudConfig.variant}
                center={pickedCenter}
                zoom={pickedZoom}
                defaultCenter={pickedCenter}
                onCameraChange={(nextCenter, nextZoom) => {
                  setPickedCenter({
                    lat: Number(nextCenter.lat.toFixed(6)),
                    lng: Number(nextCenter.lng.toFixed(6)),
                  });
                  setPickedZoom(
                    Math.min(20, Math.max(3, Math.round(nextZoom)))
                  );
                }}
              />
            )}

            {/* Fixed Center Crosshair Overlay */}
            <div
              aria-hidden="true"
              data-testid="location-picker-crosshair"
              className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            >
              <div className="relative flex items-center justify-center">
                <div className="h-12 w-12 rounded-full border-2 border-blue-600/80 bg-blue-500/10 shadow-sm backdrop-blur-[1px] flex items-center justify-center">
                  <Crosshair className="h-6 w-6 text-blue-600 dark:text-blue-400 drop-shadow-xs" />
                </div>
                <span className="absolute h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white shadow-xs" />
              </div>
            </div>
          </div>

          {/* Coordinates Readout + Use Current Location */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span
                data-testid="location-picker-coords-readout"
                className="font-mono font-semibold text-[var(--ps-text)]"
              >
                {pickedCenter.lat.toFixed(4)}, {pickedCenter.lng.toFixed(4)}
              </span>
              <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
                Zoom {pickedZoom}
              </span>
            </div>

            <button
              type="button"
              disabled={isLocating || isSaving}
              onClick={handleUseCurrentLocation}
              data-testid="location-picker-use-current-btn"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2 text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-60 cursor-pointer"
            >
              {isLocating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Navigation className="h-3.5 w-3.5" />
              )}
              <span>
                {isLocating ? 'Locating…' : 'Use My Current Location'}
              </span>
            </button>
          </div>

          {geoSuccessToast && (
            <div
              role="status"
              data-testid="location-picker-gps-success"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              {geoSuccessToast}
            </div>
          )}

          {geoError && (
            <div
              role="alert"
              data-testid="location-picker-gps-error"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300"
            >
              {geoError}
            </div>
          )}

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
              className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] px-4 py-2 text-xs font-semibold text-[var(--ps-text)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveDefaultLocation()}
              data-testid="location-picker-save-btn"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              <span>
                {isSaving ? 'Saving…' : 'Save Default Location'}
              </span>
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
