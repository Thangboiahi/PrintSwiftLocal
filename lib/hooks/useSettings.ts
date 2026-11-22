'use client';

import { useCallback, useEffect, useState } from 'react';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import {
  useThemeScale,
  hexToHsl,
  hslToHex,
  deriveUiScalePresetFromMatrix,
  DEFAULT_SCALE_MATRIX,
  DEFAULT_THEME_COLORS,
  DEFAULT_THEME_PRESET,
  SCALE_PRESETS,
  STORAGE_KEY_SCALE_MATRIX,
  STORAGE_KEY_THEME_COLORS,
  STORAGE_KEY_THEME_PRESET,
  STORAGE_KEY_UI_SCALE,
  type CuratedThemePresetId,
  type ScaleMatrixConfig,
  type ThemeColorsConfig,
  type ThemePresetId,
  type UiScaleOption,
} from '@/components/providers/ThemeScaleProvider';
import {
  STORAGE_KEY_MAP_PROMPT_DISMISSED,
  type MapSettings,
} from '@/lib/map-settings';
import {
  STORAGE_KEY_CUSTOM_DEFAULT_CENTER,
  useAppStore,
  useAuth,
  useExploreMapPreset,
  useRealEstateMode,
  useSimpleMode,
  type ExploreMapPresetId,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { SupportedLocale } from '@/lib/supabase/translations';
import type {
  AppearanceMode,
  AreaUnit,
  LatLngPoint,
  MapAppearanceVariant,
  MapStyleOption,
  ThemePreset,
} from '@/lib/types';

export const LOCALE_STORAGE_KEY = 'printswift_local_locale_v1';
export const UNIFIED_SETTINGS_STORAGE_KEY = 'printswift_unified_settings_v1';

export interface UnifiedSettingsSnapshot {
  uiScale: UiScaleOption;
  scaleMatrix: ScaleMatrixConfig;
  themeColors: ThemeColorsConfig;
  locale: SupportedLocale;
  appearanceMode: AppearanceMode;
  themePreset: ThemePreset;
  mapStyle: MapStyleOption;
  mapAppearance: MapAppearanceVariant;
  areaUnit: AreaUnit;
  simpleMode: boolean;
  realEstateMode: boolean;
  defaultMapCenter: LatLngPoint;
  defaultMapZoom: number;
}

function readInitialLocaleFromStorage(): SupportedLocale {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'mni' || saved === 'paite') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'en';
}

function applyScaleMatrixToDocumentRoot(matrix: ScaleMatrixConfig) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--scale-text', `${matrix.text}px`);
  root.style.setProperty('--scale-pad', String(matrix.pad));
  root.style.setProperty('--scale-space', String(matrix.space));
  root.style.setProperty('--ui-scale', `${matrix.text}px`);
  root.dataset.uiScale = deriveUiScalePresetFromMatrix(matrix);
}

/**
 * Phase 52-A, 54-A & 55-A: Unified Settings Engine & Draft-vs-Commit 3-Axis Scaling Hook
 * Manages savedScale (from DB/LocalStorage) and draftScale (active local edits).
 * - Moving sliders or selecting presets updates draftScale and applies CSS variables to
 *   document.documentElement for real-time visual preview without thrashing storage.
 * - commitChanges() writes draftScale to savedScale + LocalStorage + DB, then calls window.location.reload().
 * - discardChanges() reverts draftScale to savedScale and resets root CSS variables.
 */
export function useSettings() {
  const {
    appearanceMode,
    setAppearanceMode: storeSetAppearanceMode,
    themePreset,
    setThemePreset: storeSetThemePreset,
    mapStyle,
    setMapStyle: storeSetMapStyle,
    mapAppearance,
    setMapAppearance: storeSetMapAppearance,
    areaUnit,
    setAreaUnit: storeSetAreaUnit,
    effectiveDefaultCenter,
    customDefaultCenter,
    customDefaultZoom,
    setCustomDefaultCenter,
    resetCustomDefaultCenter,
    resetThemeToDefault,
  } = useAppStore();

  const { user: authUser } = useAuth();
  const authUserId = authUser?.id;
  const [simpleMode, setSimpleModeState] = useSimpleMode();
  const [realEstateMode, setRealEstateModeState] = useRealEstateMode();
  const [exploreMapPreset, setExploreMapPresetState] = useExploreMapPreset();

  const {
    uiScale,
    uiScalePx,
    scaleMatrix,
    themeColors,
    activePreset,
    setUiScale: providerSetUiScale,
    setScaleMatrix: providerSetScaleMatrix,
    setThemeColors: providerSetThemeColors,
    selectThemePreset: providerSelectThemePreset,
    resetThemeScale,
  } = useThemeScale();

  // Phase 55-C & 57: Hydration safety flag via universal useIsMounted hook — only access localStorage & inject CSS variables after mount
  const isMounted = useIsMounted();
  const { setStatus: setAppStatus } = useAppStatus();

  // Phase 55-A & 55-C: Maintain savedScale and draftScale initialized to SSR defaults (Text: 16, Pad: 1, Space: 1)
  const [savedScale, setSavedScale] = useState<ScaleMatrixConfig>(
    DEFAULT_SCALE_MATRIX
  );
  const [draftScale, setDraftScale] = useState<ScaleMatrixConfig>(
    DEFAULT_SCALE_MATRIX
  );

  const [locale, setLocaleState] = useState<SupportedLocale>('en');
  const [isSyncingProfile, setIsSyncingProfile] = useState<boolean>(false);

  useEffect(() => {
    if (!isMounted || typeof window === 'undefined') return;
    queueMicrotask(() => {
      try {
        const savedPresetRaw = window.localStorage.getItem(STORAGE_KEY_UI_SCALE);
        const savedPreset: UiScaleOption =
          savedPresetRaw === 'small' || savedPresetRaw === '14px'
            ? 'small'
            : savedPresetRaw === 'large' || savedPresetRaw === '18px'
              ? 'large'
              : 'medium';
        const fallbackMatrix = SCALE_PRESETS[savedPreset] || DEFAULT_SCALE_MATRIX;
        const rawMatrix = window.localStorage.getItem(STORAGE_KEY_SCALE_MATRIX);
        let resolvedMatrix: ScaleMatrixConfig = fallbackMatrix;
        if (rawMatrix) {
          const parsed = JSON.parse(rawMatrix) as Partial<ScaleMatrixConfig>;
          resolvedMatrix = {
            text:
              typeof parsed?.text === 'number' && Number.isFinite(parsed.text)
                ? parsed.text
                : fallbackMatrix.text,
            pad:
              typeof parsed?.pad === 'number' && Number.isFinite(parsed.pad)
                ? parsed.pad
                : fallbackMatrix.pad,
            space:
              typeof parsed?.space === 'number' && Number.isFinite(parsed.space)
                ? parsed.space
                : fallbackMatrix.space,
          };
        }
        setSavedScale(resolvedMatrix);
        setDraftScale(resolvedMatrix);
        applyScaleMatrixToDocumentRoot(resolvedMatrix);
      } catch {
        // keep default scale matrix
      }

      const initialLocale = readInitialLocaleFromStorage();
      setLocaleState(initialLocale);
    });
  }, [isMounted]);

  // Phase 55-A & 55-C: Apply draftScale CSS variables to document.documentElement only when isMounted is true
  useEffect(() => {
    if (!isMounted) return;
    applyScaleMatrixToDocumentRoot({
      text: draftScale.text,
      pad: draftScale.pad,
      space: draftScale.space,
    });
  }, [isMounted, draftScale.text, draftScale.pad, draftScale.space]);

  // Listen for external locale changes from other components or storage events
  useEffect(() => {
    if (!isMounted || typeof window === 'undefined') return;
    const handleLocaleSync = () => {
      try {
        const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (
          savedLocale === 'en' ||
          savedLocale === 'mni' ||
          savedLocale === 'paite'
        ) {
          setLocaleState((prev) => (prev === savedLocale ? prev : savedLocale));
        }
      } catch {
        // ignore storage errors
      }
    };
    window.addEventListener('storage', handleLocaleSync);
    window.addEventListener('printswift:locale-changed', handleLocaleSync);
    return () => {
      window.removeEventListener('storage', handleLocaleSync);
      window.removeEventListener('printswift:locale-changed', handleLocaleSync);
    };
  }, [isMounted]);

  const persistSnapshotToLocalStorage = useCallback(
    (partial: Partial<UnifiedSettingsSnapshot>) => {
      if (typeof window === 'undefined') return;
      try {
        const rawExisting = window.localStorage.getItem(
          UNIFIED_SETTINGS_STORAGE_KEY
        );
        const existing = rawExisting
          ? (JSON.parse(rawExisting) as Partial<UnifiedSettingsSnapshot>)
          : {};
        const merged = {
          ...existing,
          uiScale,
          scaleMatrix: savedScale,
          themeColors,
          locale,
          appearanceMode,
          themePreset,
          mapStyle,
          mapAppearance,
          areaUnit,
          simpleMode,
          realEstateMode,
          defaultMapCenter: effectiveDefaultCenter,
          defaultMapZoom: customDefaultZoom,
          ...partial,
        };
        window.localStorage.setItem(
          UNIFIED_SETTINGS_STORAGE_KEY,
          JSON.stringify(merged)
        );
      } catch {
        // ignore storage quota errors
      }
    },
    [
      uiScale,
      savedScale,
      themeColors,
      locale,
      appearanceMode,
      themePreset,
      mapStyle,
      mapAppearance,
      areaUnit,
      simpleMode,
      realEstateMode,
      effectiveDefaultCenter,
      customDefaultZoom,
    ]
  );

  // Sync changes to public.profiles when a user session exists; otherwise strictly localStorage
  const syncPreferencesToDatabaseIfAuthenticated = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!isSupabaseConfigured()) return;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const activeUserId = session?.user?.id || authUserId;
        if (!activeUserId) {
          // Guest / Visitor: strictly localStorage, no DB call
          return;
        }

        setIsSyncingProfile(true);
        setAppStatus('syncing_prefs');
        const { error } = await supabase
          .from('profiles')
          .update({
            ...payload,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeUserId);
        if (error) {
          setAppStatus('error');
        } else {
          setAppStatus('success');
        }
      } catch {
        setAppStatus('error');
        // Keep localStorage state if profile column is optional
      } finally {
        setIsSyncingProfile(false);
      }
    },
    [authUserId, setAppStatus]
  );

  // Phase 55-A: Draft-only 3-Axis Scale Matrix & Preset Helpers (Preview on DOM without saving to storage yet)
  const updateScaleMatrix = useCallback(
    (partialMatrix: Partial<ScaleMatrixConfig>) => {
      const next: ScaleMatrixConfig = {
        text:
          typeof partialMatrix.text === 'number'
            ? partialMatrix.text
            : draftScale.text,
        pad:
          typeof partialMatrix.pad === 'number'
            ? partialMatrix.pad
            : draftScale.pad,
        space:
          typeof partialMatrix.space === 'number'
            ? partialMatrix.space
            : draftScale.space,
      };
      setDraftScale(next);
      applyScaleMatrixToDocumentRoot(next);
      return next;
    },
    [draftScale.text, draftScale.pad, draftScale.space]
  );

  const setSmallPreset = useCallback((): ScaleMatrixConfig => {
    const preset: ScaleMatrixConfig = { text: 14, pad: 0.8, space: 0.8 };
    setDraftScale(preset);
    applyScaleMatrixToDocumentRoot(preset);
    return preset;
  }, []);

  const setMediumPreset = useCallback((): ScaleMatrixConfig => {
    const preset: ScaleMatrixConfig = { text: 16, pad: 1, space: 1 };
    setDraftScale(preset);
    applyScaleMatrixToDocumentRoot(preset);
    return preset;
  }, []);

  const setLargePreset = useCallback((): ScaleMatrixConfig => {
    const preset: ScaleMatrixConfig = { text: 18, pad: 1.2, space: 1.2 };
    setDraftScale(preset);
    applyScaleMatrixToDocumentRoot(preset);
    return preset;
  }, []);

  const updateUiScale = useCallback(
    (nextScale: UiScaleOption) => {
      if (nextScale === 'small') {
        setSmallPreset();
        return;
      }
      if (nextScale === 'large') {
        setLargePreset();
        return;
      }
      setMediumPreset();
    },
    [setSmallPreset, setMediumPreset, setLargePreset]
  );

  // Phase 55-A: Commit draftScale to savedScale + LocalStorage + DB, then reload page
  const commitChanges = useCallback(async () => {
    setAppStatus('saving');
    const committed: ScaleMatrixConfig = {
      text: draftScale.text,
      pad: draftScale.pad,
      space: draftScale.space,
    };
    const derivedUiScale = deriveUiScalePresetFromMatrix(committed);
    setSavedScale(committed);
    applyScaleMatrixToDocumentRoot(committed);
    providerSetScaleMatrix(committed);
    persistSnapshotToLocalStorage({
      uiScale: derivedUiScale,
      scaleMatrix: committed,
    });
    await syncPreferencesToDatabaseIfAuthenticated({
      ui_scale: derivedUiScale,
      ui_scale_matrix: committed,
    });
    setAppStatus('success');
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, [
    draftScale.text,
    draftScale.pad,
    draftScale.space,
    providerSetScaleMatrix,
    persistSnapshotToLocalStorage,
    syncPreferencesToDatabaseIfAuthenticated,
    setAppStatus,
  ]);

  // Phase 55-A: Discard draftScale changes, revert to savedScale and reset root CSS variables
  const discardChanges = useCallback(() => {
    const reverted: ScaleMatrixConfig = {
      text: savedScale.text,
      pad: savedScale.pad,
      space: savedScale.space,
    };
    setDraftScale(reverted);
    applyScaleMatrixToDocumentRoot(reverted);
  }, [savedScale.text, savedScale.pad, savedScale.space]);

  const updateColorTier = useCallback(
    (
      tier: 'primary' | 'secondary' | 'accent',
      hexOrHsl: string
    ) => {
      const hslVal = hexOrHsl.startsWith('#')
        ? hexToHsl(hexOrHsl)
        : hexOrHsl.trim();
      const nextColors: ThemeColorsConfig = {
        ...themeColors,
        [tier]: hslVal,
      };
      providerSetThemeColors({ [tier]: hslVal }, { presetId: 'custom' });
      persistSnapshotToLocalStorage({ themeColors: nextColors });
      void syncPreferencesToDatabaseIfAuthenticated({
        theme_colors: nextColors,
        theme_preset: 'custom',
      });
    },
    [
      themeColors,
      providerSetThemeColors,
      persistSnapshotToLocalStorage,
      syncPreferencesToDatabaseIfAuthenticated,
    ]
  );

  const selectColorPreset = useCallback(
    (presetId: CuratedThemePresetId) => {
      const nextColors = providerSelectThemePreset(presetId);
      const legacyStoreMap: Record<CuratedThemePresetId, ThemePreset> = {
        minimal_neutral: 'neutral',
        warm_clay: 'clay',
        lamka_pine: 'forest',
        royal_indigo: 'ocean',
        midnight_rose: 'slate',
      };
      storeSetThemePreset(legacyStoreMap[presetId] || 'neutral');
      persistSnapshotToLocalStorage({
        themeColors: nextColors,
        themePreset: legacyStoreMap[presetId] || 'neutral',
      });
      void syncPreferencesToDatabaseIfAuthenticated({
        theme_preset: presetId,
        theme_colors: nextColors,
      });
    },
    [
      providerSelectThemePreset,
      storeSetThemePreset,
      persistSnapshotToLocalStorage,
      syncPreferencesToDatabaseIfAuthenticated,
    ]
  );

  const updateLocale = useCallback(
    (nextLocale: SupportedLocale) => {
      setLocaleState(nextLocale);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
          window.dispatchEvent(
            new CustomEvent('printswift:locale-changed', { detail: nextLocale })
          );
        } catch {
          // ignore
        }
      }
      persistSnapshotToLocalStorage({ locale: nextLocale });
      void syncPreferencesToDatabaseIfAuthenticated({
        preferred_locale: nextLocale,
      });
    },
    [persistSnapshotToLocalStorage, syncPreferencesToDatabaseIfAuthenticated]
  );

  const updateAppearanceMode = useCallback(
    (mode: AppearanceMode) => {
      storeSetAppearanceMode(mode);
      persistSnapshotToLocalStorage({ appearanceMode: mode });
      void syncPreferencesToDatabaseIfAuthenticated({ appearance_mode: mode });
    },
    [
      storeSetAppearanceMode,
      persistSnapshotToLocalStorage,
      syncPreferencesToDatabaseIfAuthenticated,
    ]
  );

  const updateThemePreset = useCallback(
    (preset: ThemePreset) => {
      storeSetThemePreset(preset);
      persistSnapshotToLocalStorage({ themePreset: preset });
      void syncPreferencesToDatabaseIfAuthenticated({ theme_preset: preset });
    },
    [
      storeSetThemePreset,
      persistSnapshotToLocalStorage,
      syncPreferencesToDatabaseIfAuthenticated,
    ]
  );

  const updateMapStyle = useCallback(
    (style: MapStyleOption) => {
      storeSetMapStyle(style);
      persistSnapshotToLocalStorage({ mapStyle: style });
      void syncPreferencesToDatabaseIfAuthenticated({ map_style: style });
    },
    [
      storeSetMapStyle,
      persistSnapshotToLocalStorage,
      syncPreferencesToDatabaseIfAuthenticated,
    ]
  );

  const updateMapAppearance = useCallback(
    (variant: MapAppearanceVariant) => {
      storeSetMapAppearance(variant);
      persistSnapshotToLocalStorage({ mapAppearance: variant });
    },
    [storeSetMapAppearance, persistSnapshotToLocalStorage]
  );

  const updateAreaUnit = useCallback(
    (unit: AreaUnit) => {
      storeSetAreaUnit(unit);
      persistSnapshotToLocalStorage({ areaUnit: unit });
      void syncPreferencesToDatabaseIfAuthenticated({ area_unit: unit });
    },
    [
      storeSetAreaUnit,
      persistSnapshotToLocalStorage,
      syncPreferencesToDatabaseIfAuthenticated,
    ]
  );

  const updateSimpleMode = useCallback(
    (enabled: boolean) => {
      setSimpleModeState(enabled);
      persistSnapshotToLocalStorage({ simpleMode: enabled });
    },
    [setSimpleModeState, persistSnapshotToLocalStorage]
  );

  const updateRealEstateMode = useCallback(
    (enabled: boolean) => {
      setRealEstateModeState(enabled);
      persistSnapshotToLocalStorage({ realEstateMode: enabled });
    },
    [setRealEstateModeState, persistSnapshotToLocalStorage]
  );

  const updateExploreMapPreset = useCallback(
    (preset: ExploreMapPresetId) => {
      setExploreMapPresetState(preset);
      persistSnapshotToLocalStorage({
        simpleMode: preset === 'clean_focus',
        realEstateMode: preset === 'property_hunter',
      });
    },
    [setExploreMapPresetState, persistSnapshotToLocalStorage]
  );

  const updateDefaultMapLocation = useCallback(
    async (center: LatLngPoint, zoom = customDefaultZoom || 15) => {
      setAppStatus('saving');
      const normalizedZoom = Math.min(20, Math.max(3, Math.round(zoom)));
      const payload: MapSettings = {
        lat: Number(center.lat.toFixed(6)),
        lng: Number(center.lng.toFixed(6)),
        zoom: normalizedZoom,
        configured: true,
      };

      // Always update local state & localStorage immediately
      setCustomDefaultCenter(
        { lat: payload.lat, lng: payload.lng },
        payload.zoom
      );
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
      persistSnapshotToLocalStorage({
        defaultMapCenter: { lat: payload.lat, lng: payload.lng },
        defaultMapZoom: payload.zoom,
      });

      // Sync to cookie + public.profiles if authenticated
      try {
        let accessToken: string | undefined;
        let activeUserId: string | undefined = authUserId;
        if (isSupabaseConfigured()) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          accessToken = session?.access_token;
          activeUserId = session?.user?.id || activeUserId;

          if (activeUserId) {
            await supabase
              .from('profiles')
              .update({
                default_lat: payload.lat,
                default_lng: payload.lng,
                default_zoom: payload.zoom,
                map_settings: payload,
                updated_at: new Date().toISOString(),
              })
              .eq('id', activeUserId);
          }
        }

        await fetch('/api/profile/update-map-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        setAppStatus('success');
      } catch {
        // LocalStorage fallback already succeeded
        setAppStatus('success');
      }

      return payload;
    },
    [
      customDefaultZoom,
      setCustomDefaultCenter,
      persistSnapshotToLocalStorage,
      authUserId,
      setAppStatus,
    ]
  );

  const resetDefaultMapLocation = useCallback(async () => {
    resetCustomDefaultCenter();
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY_CUSTOM_DEFAULT_CENTER);
      } catch {
        // ignore
      }
    }
    try {
      let accessToken: string | undefined;
      if (isSupabaseConfigured()) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        accessToken = session?.access_token;
      }
      await fetch('/api/profile/update-map-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ reset: true }),
      });
    } catch {
      // ignore network error on reset
    }
  }, [resetCustomDefaultCenter]);

  const resetAllSettings = useCallback(() => {
    resetThemeToDefault();
    resetThemeScale();
    setSavedScale(DEFAULT_SCALE_MATRIX);
    setDraftScale(DEFAULT_SCALE_MATRIX);
    applyScaleMatrixToDocumentRoot(DEFAULT_SCALE_MATRIX);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY_UI_SCALE, 'medium');
        window.localStorage.setItem(
          STORAGE_KEY_SCALE_MATRIX,
          JSON.stringify(DEFAULT_SCALE_MATRIX)
        );
        window.localStorage.setItem(
          STORAGE_KEY_THEME_COLORS,
          JSON.stringify(DEFAULT_THEME_COLORS)
        );
        window.localStorage.setItem(
          STORAGE_KEY_THEME_PRESET,
          DEFAULT_THEME_PRESET
        );
      } catch {
        // ignore
      }
    }
  }, [resetThemeToDefault, resetThemeScale]);

  const safeSavedScale: ScaleMatrixConfig = isMounted
    ? savedScale
    : DEFAULT_SCALE_MATRIX;
  const safeDraftScale: ScaleMatrixConfig = isMounted
    ? draftScale
    : DEFAULT_SCALE_MATRIX;

  const hasUnsavedScaleChanges =
    isMounted &&
    (safeDraftScale.text !== safeSavedScale.text ||
      Math.abs(safeDraftScale.pad - safeSavedScale.pad) > 0.001 ||
      Math.abs(safeDraftScale.space - safeSavedScale.space) > 0.001);

  return {
    isMounted,
    isAuthenticated: Boolean(authUser?.id),
    isSyncingProfile,
    uiScale: isMounted ? uiScale : 'medium',
    uiScalePx: isMounted ? uiScalePx : '16px',
    savedScale: safeSavedScale,
    draftScale: safeDraftScale,
    hasUnsavedScaleChanges,
    commitChanges,
    discardChanges,
    scale: safeDraftScale,
    scaleMatrix: safeDraftScale,
    themeColors: isMounted ? themeColors : DEFAULT_THEME_COLORS,
    activePreset: isMounted
      ? activePreset
      : (DEFAULT_THEME_PRESET as ThemePresetId),
    locale: isMounted ? locale : 'en',
    appearanceMode: isMounted ? appearanceMode : ('system' as AppearanceMode),
    themePreset: isMounted ? themePreset : ('neutral' as ThemePreset),
    mapStyle: isMounted ? mapStyle : ('roadmap' as MapStyleOption),
    mapAppearance: isMounted ? mapAppearance : ('light' as MapAppearanceVariant),
    areaUnit: isMounted ? areaUnit : ('sqm' as AreaUnit),
    simpleMode: isMounted ? simpleMode : false,
    realEstateMode: isMounted ? realEstateMode : false,
    exploreMapPreset: isMounted ? exploreMapPreset : ('everyday' as ExploreMapPresetId),
    effectiveDefaultCenter,
    customDefaultCenter,
    customDefaultZoom,
    setSmallPreset,
    setMediumPreset,
    setLargePreset,
    updateScaleMatrix,
    updateUiScale,
    updateColorTier,
    selectColorPreset,
    updateLocale,
    updateAppearanceMode,
    updateThemePreset,
    updateMapStyle,
    updateMapAppearance,
    updateAreaUnit,
    updateSimpleMode,
    updateRealEstateMode,
    updateExploreMapPreset,
    updateDefaultMapLocation,
    resetDefaultMapLocation,
    resetThemeScale,
    resetThemeToDefault,
    resetAllSettings,
    providerSetUiScale,
    SCALE_PRESETS,
    hexToHsl,
    hslToHex,
  };
}

export default useSettings;

