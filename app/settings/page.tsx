'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowLeft,
  Bell,
  Check,
  Compass,
  Database,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Map,
  MapPin,
  Navigation,
  Palette,
  RotateCcw,
  Ruler,
  Shield,
  Sliders,
  Trash2,
  Type,
} from 'lucide-react';
import { LocationPickerModal } from '@/components/map/LocationPickerModal';
import { type UiScaleOption } from '@/components/providers/ThemeScaleProvider';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { useSettings } from '@/lib/hooks/useSettings';
import { AppProvider, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  AreaUnit,
  AppearanceMode,
  MapAppearanceVariant,
  MapStyleOption,
  ThemePreset,
} from '@/lib/types';
import {
  fetchTranslationsForLocale,
  STATIC_MESSAGES_BY_LOCALE,
  type MessagesDictionary,
  type SupportedLocale,
} from '@/lib/supabase/translations';

const LOCALE_OPTIONS: Array<{ value: SupportedLocale; label: string }> = [
  { value: 'en', label: 'English (en)' },
  { value: 'mni', label: 'Manipuri (mni)' },
  { value: 'paite', label: 'Paite (paite)' },
];

const UI_SCALE_OPTIONS: Array<{ value: UiScaleOption; label: string }> = [
  { value: 'small', label: 'Small (14px)' },
  { value: 'medium', label: 'Medium (16px)' },
  { value: 'large', label: 'Large (18px)' },
];

const THEME_PRESET_OPTIONS: Array<{
  id: ThemePreset;
  name: string;
  description: string;
  swatchBg: string;
  swatchAccent: string;
}> = [
  {
    id: 'neutral',
    name: 'Minimal Neutral',
    description: 'Clean, restrained architectural monochrome (Default)',
    swatchBg: '#f8fafc',
    swatchAccent: '#18181b',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Crisp coastal blue surfaces and sky accents',
    swatchBg: '#f0f7ff',
    swatchAccent: '#0284c7',
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Botanical hill-district greens with high contrast',
    swatchBg: '#f2f8f5',
    swatchAccent: '#059669',
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Precision engineering cool-slate palette',
    swatchBg: '#f8fafc',
    swatchAccent: '#334155',
  },
  {
    id: 'clay',
    name: 'Warm Clay',
    description: 'Earth-toned stone and warm amber highlights',
    swatchBg: '#faf6f3',
    swatchAccent: '#b45309',
  },
];

const MESSAGES_MAP: Record<SupportedLocale, MessagesDictionary> =
  STATIC_MESSAGES_BY_LOCALE;

const STORAGE_KEY_PUSH_NOTIFICATIONS = 'printswift_push_notifications_v1';
const STORAGE_KEY_EMAIL_ALERTS = 'printswift_email_alerts_v1';

function SettingsContent() {
  const t = useTranslations('Settings');
  const { session: storeSession, user: storeUser } = useAuth();
  const {
    isAuthenticated,
    isSyncingProfile,
    uiScale,
    uiScalePx,
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
    updateUiScale,
    updateColorTier,
    updateLocale,
    updateAppearanceMode,
    updateThemePreset,
    updateMapStyle,
    updateMapAppearance,
    updateAreaUnit,
    updateSimpleMode,
    updateRealEstateMode,
    updateDefaultMapLocation,
    resetDefaultMapLocation,
    resetThemeScale,
    resetThemeToDefault,
    hslToHex,
  } = useSettings();

  const [session, setSession] = useState<Session | null>(storeSession);
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [gpsStatusMessage, setGpsStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [accountActionMessage, setAccountActionMessage] = useState<string | null>(
    null
  );

  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState<boolean>(
    () => {
      if (typeof window === 'undefined') return true;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY_PUSH_NOTIFICATIONS);
        return saved === null ? true : saved === 'true';
      } catch {
        return true;
      }
    }
  );

  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY_EMAIL_ALERTS);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  // Consume user session at the top of the Settings page via supabase.auth.getSession()
  useEffect(() => {
    let active = true;
    async function loadSession() {
      if (!isSupabaseConfigured()) return;
      try {
        const {
          data: { session: liveSession },
        } = await supabase.auth.getSession();
        if (active && liveSession) {
          setSession(liveSession);
        }
      } catch {
        // Fallback to store session
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  const resolvedSessionUser = session?.user || storeSession?.user || storeUser;

  const handleTogglePushNotifications = (next: boolean) => {
    setPushNotificationsEnabled(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          STORAGE_KEY_PUSH_NOTIFICATIONS,
          String(next)
        );
      } catch {
        // ignore storage errors
      }
    }
  };

  const handleToggleEmailAlerts = (next: boolean) => {
    setEmailAlertsEnabled(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY_EMAIL_ALERTS, String(next));
      } catch {
        // ignore storage errors
      }
    }
  };

  const handleClearLocalCache = () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.clear();
    } catch {
      // ignore storage errors
    }
    window.location.reload();
  };

  const handleUseCurrentLocation = () => {
    setGpsStatusMessage(null);
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatusMessage({
        type: 'error',
        text: 'Geolocation is not supported in this browser.',
      });
      return;
    }

    setIsLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCenter = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        const nextZoom = Math.max(customDefaultZoom || 13, 15);
        void updateDefaultMapLocation(nextCenter, nextZoom).finally(() => {
          setIsLocatingGps(false);
          setGpsStatusMessage({
            type: 'success',
            text: `Default map center updated to your GPS coordinates (${nextCenter.lat.toFixed(4)}, ${nextCenter.lng.toFixed(4)}).`,
          });
        });
      },
      (err) => {
        setIsLocatingGps(false);
        const isPermissionDenied =
          err.code === 1 || /denied|permission/i.test(err.message || '');
        setGpsStatusMessage({
          type: 'error',
          text: isPermissionDenied
            ? 'Location permission denied. Please allow location access in your browser settings or pick a point on the map.'
            : err.message || 'Unable to retrieve your current GPS location.',
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  return (
    <div className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Link
            href="/explore"
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Discovery Map</span>
          </Link>

          <div className="flex items-center gap-3 text-xs font-semibold">
            <span
              data-testid="settings-persistence-mode-badge"
              className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1 text-[11px] font-medium text-[var(--ps-text-muted)]"
            >
              {isAuthenticated || Boolean(resolvedSessionUser)
                ? isSyncingProfile
                  ? 'Syncing to Profile…'
                  : 'Synced to Profile & LocalStorage'
                : 'Guest Mode (Saved to LocalStorage)'}
            </span>
            <Link
              href="/profile"
              className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              Profile
            </Link>
            <span className="text-[var(--ps-border)]">•</span>
            <Link
              href="/settings"
              aria-current="page"
              className="text-[var(--ps-accent)]"
            >
              {t('title')}
            </Link>
          </div>
        </div>

        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ps-accent)]">
            <Sliders className="h-3.5 w-3.5" />
            <span>{t('badge')}</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ps-text)]">
            {t('title')}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ps-text-muted)]">
            {t('subtitle')}
          </p>
        </section>

        {/* Language & Localization Selector (CustomSelectModal) */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              {t('languageSectionTitle')}
            </h2>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            {t('languageDescription')}
          </p>

          <div className="max-w-sm">
            <CustomSelectModal
              id="settings-language-select"
              testId="settings-language-select"
              label={t('languageLabel')}
              value={locale}
              options={LOCALE_OPTIONS}
              placeholder="Select language"
              onChange={(val) => updateLocale(val as SupportedLocale)}
            />
          </div>
        </section>

        {/* UI Scale Settings (Phase 51-B & 52-A CustomSelectModal) */}
        <section
          data-testid="settings-ui-scale-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Type className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                UI Scale Settings
              </h2>
            </div>
            <span className="text-xs font-mono text-[var(--ps-text-muted)]">
              Root rem: {uiScalePx}
            </span>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Dynamically scales all typography, spacing, and interactive controls across the application without reloading.
          </p>

          <div className="max-w-sm">
            <CustomSelectModal
              id="settings-ui-scale-select"
              testId="settings-ui-scale-select"
              label="Interface Scale"
              value={uiScale}
              options={UI_SCALE_OPTIONS}
              placeholder="Select UI Scale"
              onChange={(val) => updateUiScale(val as UiScaleOption)}
            />
          </div>
        </section>

        {/* Phase 53-B: Consolidated "Theme & Appearance" Section (Appearance Mode + Presets + Divider + 3-Tier HSL Color Pickers) */}
        <section
          data-testid="settings-theme-appearance-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Theme &amp; Appearance
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  resetThemeToDefault();
                  resetThemeScale();
                }}
                data-testid="settings-reset-custom-colors-btn"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>{t('resetTheme')}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {(['light', 'dark', 'system'] as AppearanceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => updateAppearanceMode(mode)}
                className={`min-h-[44px] rounded-xl border px-3 py-2.5 text-xs font-bold capitalize transition cursor-pointer ${
                  appearanceMode === mode
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="pt-2">
            <div className="text-xs font-bold text-[var(--ps-text)] mb-2">
              Colour Theme Presets
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {THEME_PRESET_OPTIONS.map((preset) => {
                const active = themePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => updateThemePreset(preset.id)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]/60'
                    }`}
                  >
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      <span
                        className="w-4 h-4 rounded-full border border-slate-300"
                        style={{ backgroundColor: preset.swatchBg }}
                      />
                      <span
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: preset.swatchAccent }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-[var(--ps-text)]">
                          {preset.name}
                        </span>
                        {active && (
                          <Check className="w-3.5 h-3.5 text-[var(--ps-text)]" />
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                        {preset.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <hr className="my-4 border-slate-200 dark:border-slate-800" />

          <div data-testid="settings-custom-colors-section" className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Custom Interface Colors
              </h3>
              <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                Customize the 3-tier HSL color variables injected into the root stylesheet.
              </p>
            </div>

            {/* Row 1: Primary Brand Color */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Primary Brand Color
                </div>
                <div className="text-[11px] font-mono text-[var(--ps-text-muted)] truncate">
                  --color-primary: {themeColors.primary}
                </div>
              </div>
              <input
                type="color"
                aria-label="Primary Brand Color"
                data-testid="color-picker-primary"
                value={hslToHex(themeColors.primary, '#2563eb')}
                onChange={(e) => updateColorTier('primary', e.target.value)}
                className="w-10 h-10 p-0 border-0 rounded-full overflow-hidden cursor-pointer shrink-0"
              />
            </div>

            {/* Row 2: Secondary Background Tint */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Secondary Background Tint
                </div>
                <div className="text-[11px] font-mono text-[var(--ps-text-muted)] truncate">
                  --color-secondary: {themeColors.secondary}
                </div>
              </div>
              <input
                type="color"
                aria-label="Secondary Background Tint"
                data-testid="color-picker-secondary"
                value={hslToHex(themeColors.secondary, '#f1f5f9')}
                onChange={(e) => updateColorTier('secondary', e.target.value)}
                className="w-10 h-10 p-0 border-0 rounded-full overflow-hidden cursor-pointer shrink-0"
              />
            </div>

            {/* Row 3: Accent/Highlight Color */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Accent/Highlight Color
                </div>
                <div className="text-[11px] font-mono text-[var(--ps-text-muted)] truncate">
                  --color-accent: {themeColors.accent}
                </div>
              </div>
              <input
                type="color"
                aria-label="Accent/Highlight Color"
                data-testid="color-picker-accent"
                value={hslToHex(themeColors.accent, '#f59e0b')}
                onChange={(e) => updateColorTier('accent', e.target.value)}
                className="w-10 h-10 p-0 border-0 rounded-full overflow-hidden cursor-pointer shrink-0"
              />
            </div>
          </div>
        </section>

        {/* Default Map Behaviors & GPS Recenter */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              {t('mapPreferences')}
            </h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
              <div>
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Simple Mode (Hide Advanced Draw &amp; Measure Tools)
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Keeps the map toolbar minimal for everyday browsing.
                </p>
              </div>
              <input
                type="checkbox"
                checked={simpleMode}
                onChange={(e) => updateSimpleMode(e.target.checked)}
                aria-label="Toggle Simple Mode"
                className="h-4 w-4 accent-[var(--ps-accent)] cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
              <div>
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Real Estate Mode
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Filters the discovery map exclusively to property listings and renders plot boundary polygons.
                </p>
              </div>
              <input
                type="checkbox"
                checked={realEstateMode}
                onChange={(e) => updateRealEstateMode(e.target.checked)}
                aria-label="Toggle Real Estate Mode"
                className="h-4 w-4 accent-[var(--ps-accent)] cursor-pointer"
              />
            </div>

            {/* Cloud Map Light/Dark Appearance */}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              {(
                [
                  { id: 'light', label: 'Cloud Map: Neutral Light' },
                  { id: 'dark', label: 'Cloud Map: Midnight Dark' },
                ] as Array<{ id: MapAppearanceVariant; label: string }>
              ).map((scheme) => (
                <button
                  key={scheme.id}
                  type="button"
                  onClick={() => updateMapAppearance(scheme.id)}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                    mapAppearance === scheme.id
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                  }`}
                >
                  {scheme.label}
                </button>
              ))}
            </div>

            {/* Map Base Layer Style */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 pt-1">
              {(
                ['roadmap', 'dark', 'satellite', 'hybrid'] as MapStyleOption[]
              ).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => updateMapStyle(style)}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition cursor-pointer ${
                    mapStyle === style
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                  }`}
                >
                  Map: {style}
                </button>
              ))}
            </div>

            {/* Phase 53-B: Default Map Center + Recenter Spacing (`mb-4` coordinate label & `flex flex-col gap-3 mt-5` button stack) */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-xs">
              <div className="flex items-center gap-2 mb-4">
                <Compass className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
                <span>
                  Default Map Centre:{' '}
                  <strong
                    data-testid="settings-default-center-readout"
                    className="font-mono"
                  >
                    {effectiveDefaultCenter.lat.toFixed(4)},{' '}
                    {effectiveDefaultCenter.lng.toFixed(4)}
                  </strong>
                  <span className="ml-1.5 text-[11px] text-[var(--ps-text-muted)]">
                    (Zoom {customDefaultZoom})
                  </span>
                </span>
              </div>

              <div className="flex flex-col gap-3 mt-5">
                <button
                  type="button"
                  disabled={isLocatingGps}
                  data-testid="settings-use-current-location-btn"
                  onClick={handleUseCurrentLocation}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2.5 text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {isLocatingGps ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Navigation className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {isLocatingGps ? 'Locating…' : 'Use My Current Location'}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="settings-open-location-picker-btn"
                  onClick={() => setIsLocationPickerOpen(true)}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  <span>Set Default Map Location</span>
                </button>

                <button
                  type="button"
                  data-testid="settings-reset-default-center-btn"
                  onClick={() => void resetDefaultMapLocation()}
                  className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                >
                  Reset to Churachandpur Centre
                </button>
              </div>

              {gpsStatusMessage && (
                <div
                  role={gpsStatusMessage.type === 'error' ? 'alert' : 'status'}
                  data-testid="settings-gps-status-message"
                  className={`mt-3 rounded-xl border px-3 py-2 text-xs font-medium ${
                    gpsStatusMessage.type === 'error'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {gpsStatusMessage.text}
                </div>
              )}
            </div>
          </div>

          <LocationPickerModal
            open={isLocationPickerOpen}
            onClose={() => setIsLocationPickerOpen(false)}
          />
        </section>

        {/* Area Unit Preference */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              {t('areaUnitTitle')}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {(
              [
                { id: 'sqm', label: 'Square Metres (m²)' },
                { id: 'sqft', label: 'Square Feet (ft²)' },
                { id: 'acre', label: 'Acres' },
                { id: 'hectare', label: 'Hectares (ha)' },
              ] as Array<{ id: AreaUnit; label: string }>
            ).map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => updateAreaUnit(unit.id)}
                className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                  areaUnit === unit.id
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                }`}
              >
                {unit.label}
              </button>
            ))}
          </div>
        </section>

        {/* Phase 53-B: Notifications & Communications (Visible to all, requires session for advanced routing) */}
        <section
          data-testid="settings-notifications-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Notifications &amp; Communications
              </h2>
            </div>
            {!resolvedSessionUser && (
              <span className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                Sign in to sync server alerts
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Configure browser push notifications for PWA service workers and email alerts for listing approvals.
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
              <div>
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Push Notifications
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Receive instant browser &amp; PWA service worker notifications for nearby updates and messages.
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="settings-toggle-push-notifications"
                checked={pushNotificationsEnabled}
                onChange={(e) =>
                  handleTogglePushNotifications(e.target.checked)
                }
                aria-label="Toggle Push Notifications"
                className="h-4 w-4 accent-[var(--ps-accent)] cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
              <div>
                <div className="text-xs font-bold text-[var(--ps-text)]">
                  Email Alerts
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Receive automated email notifications for listing approvals, moderation status, and enquiries.
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="settings-toggle-email-alerts"
                checked={emailAlertsEnabled}
                onChange={(e) => handleToggleEmailAlerts(e.target.checked)}
                aria-label="Toggle Email Alerts"
                className="h-4 w-4 accent-[var(--ps-accent)] cursor-pointer"
              />
            </div>
          </div>
        </section>

        {/* Phase 53-B: Auth-Gated "Account & Security" Section (Strictly rendered when session?.user exists) */}
        {Boolean(resolvedSessionUser) && (
          <section
            data-testid="settings-account-security-section"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Account &amp; Security
              </h2>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Manage your authenticated credentials, social logins, and account lifecycle.
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              <button
                type="button"
                data-testid="settings-change-password-btn"
                onClick={() =>
                  setAccountActionMessage(
                    'Password recovery and change flow is available via your verified email address.'
                  )
                }
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
              >
                <KeyRound className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                <span>Change Password</span>
              </button>

              <button
                type="button"
                data-testid="settings-manage-social-accounts-btn"
                onClick={() =>
                  setAccountActionMessage(
                    'Social account connections can be linked from your Edit Profile workspace.'
                  )
                }
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
              >
                <Link2 className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                <span>Manage Connected Social Accounts</span>
              </button>

              <button
                type="button"
                data-testid="settings-delete-account-btn"
                onClick={() =>
                  setAccountActionMessage(
                    'Account deletion requests require administrative confirmation to protect active directory listings.'
                  )
                }
                className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Account</span>
              </button>
            </div>

            {accountActionMessage && (
              <div
                role="status"
                data-testid="settings-account-action-status"
                className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3.5 py-2.5 text-xs font-medium text-blue-700 dark:text-blue-300"
              >
                {accountActionMessage}
              </div>
            )}
          </section>
        )}

        {/* Phase 53-B: Data & Privacy Section */}
        <section
          data-testid="settings-data-privacy-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Data &amp; Privacy
            </h2>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Reset cached UI scales, custom HSL color overrides, and local device preferences to factory defaults.
          </p>

          <div>
            <button
              type="button"
              data-testid="settings-clear-local-cache-btn"
              onClick={handleClearLocalCache}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Local Cache</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function LocalizedSettingsShell() {
  const { locale } = useSettings();
  const [messagesByLocale, setMessagesByLocale] =
    useState<Record<SupportedLocale, MessagesDictionary>>(MESSAGES_MAP);

  useEffect(() => {
    let active = true;
    const syncRemoteTranslations = () => {
      fetchTranslationsForLocale(locale)
        .then((remoteMessages) => {
          if (!active) return;
          setMessagesByLocale((prev) => ({
            ...prev,
            [locale]: remoteMessages,
          }));
        })
        .catch(() => {
          // Keep static fallback messages on failure
        });
    };

    syncRemoteTranslations();
    window.addEventListener(
      'printswift:translations-updated',
      syncRemoteTranslations
    );

    return () => {
      active = false;
      window.removeEventListener(
        'printswift:translations-updated',
        syncRemoteTranslations
      );
    };
  }, [locale]);

  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Kolkata"
      messages={messagesByLocale[locale] || MESSAGES_MAP[locale]}
    >
      <SettingsContent />
    </NextIntlClientProvider>
  );
}

export default function SettingsPage() {
  return (
    <AppProvider>
      <LocalizedSettingsShell />
    </AppProvider>
  );
}
