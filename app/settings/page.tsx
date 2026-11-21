'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowLeft,
  Bell,
  Bookmark,
  Check,
  Compass,
  Database,
  FileText,
  Globe,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Map,
  MapPin,
  MessageCircle,
  Navigation,
  Palette,
  Receipt,
  RotateCcw,
  Ruler,
  Shield,
  ShieldCheck,
  Sliders,
  Trash2,
  Type,
} from 'lucide-react';
import { LocationPickerModal } from '@/components/map/LocationPickerModal';
import { UnifiedHubModal } from '@/components/hub/UnifiedHubModal';
import {
  useAppConfig,
  useHub,
} from '@/components/providers/AppConfigProvider';
import {
  THEME_PRESETS,
  type UiScaleOption,
} from '@/components/providers/ThemeScaleProvider';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import {
  LocalityCombobox,
  type LocalitySelection,
} from '@/components/ui/LocalityCombobox';
import { setAuthStoreState } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useSettings } from '@/lib/hooks/useSettings';
import { sanitizePhoneForWhatsApp } from '@/lib/pick-n-drop/types';
import { AppProvider, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  AreaUnit,
  AppearanceMode,
  MapAppearanceVariant,
  MapStyleOption,
} from '@/lib/types';
import {
  fetchTranslationsForLocale,
  STATIC_MESSAGES_BY_LOCALE,
  type MessagesDictionary,
  type SupportedLocale,
} from '@/lib/supabase/translations';

const BASE_LANGUAGE_CATALOG: Array<{
  value: string;
  baseLocale: SupportedLocale;
  label: string;
  aliases: string[];
}> = [
  {
    value: 'en',
    baseLocale: 'en',
    label: 'English (en)',
    aliases: ['en', 'english'],
  },
  {
    value: 'paite',
    baseLocale: 'paite',
    label: 'Paite (paite)',
    aliases: ['paite'],
  },
  {
    value: 'mni',
    baseLocale: 'mni',
    label: 'Manipuri / Meiteilon (mni)',
    aliases: ['mni', 'manipuri', 'meiteilon'],
  },
  {
    value: 'mizo',
    baseLocale: 'en',
    label: 'Mizo (mizo)',
    aliases: ['mizo', 'lus'],
  },
];

const UI_SCALE_OPTIONS: Array<{ value: UiScaleOption; label: string }> = [
  { value: 'small', label: 'Small (14px)' },
  { value: 'medium', label: 'Medium (16px)' },
  { value: 'large', label: 'Large (18px)' },
];

const MESSAGES_MAP: Record<SupportedLocale, MessagesDictionary> =
  STATIC_MESSAGES_BY_LOCALE;

const STORAGE_KEY_PUSH_NOTIFICATIONS = 'printswift_push_notifications_v1';
const STORAGE_KEY_EMAIL_ALERTS = 'printswift_email_alerts_v1';
const STORAGE_KEY_DEFAULT_LOCALITY = 'psl_default_locality';

function SettingsContent() {
  const t = useTranslations('Settings');
  const {
    localities: configLocalities,
    hubLocalities,
    office,
  } = useAppConfig();
  const { hubs, activeHub, switchHub } = useHub();
  const { setStatus } = useAppStatus();
  const { session: storeSession, user: storeUser } = useAuth();
  const {
    isAuthenticated,
    isSyncingProfile,
    uiScale,
    uiScalePx,
    themeColors,
    activePreset,
    locale,
    appearanceMode,
    mapStyle,
    mapAppearance,
    areaUnit,
    simpleMode,
    realEstateMode,
    effectiveDefaultCenter,
    customDefaultZoom,
    updateUiScale,
    updateColorTier,
    selectColorPreset,
    updateLocale,
    updateAppearanceMode,
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
  const [defaultLocalitySelection, setDefaultLocalitySelection] =
    useState<LocalitySelection | null>(null);
  const [hubSaveFeedback, setHubSaveFeedback] = useState<string | null>(null);
  const [selectedLangCode, setSelectedLangCode] = useState<string>(locale);
  const [isUnifiedHubModalOpen, setIsUnifiedHubModalOpen] = useState(false);
  const [unifiedHubInitialView, setUnifiedHubInitialView] = useState<
    'list' | 'request'
  >('list');
  const [unifiedHubPrefill, setUnifiedHubPrefill] = useState<{
    city: string;
    state: string;
  }>({ city: '', state: '' });

  const [locationPermissionState, setLocationPermissionState] = useState<
    'granted' | 'prompt' | 'denied' | 'unknown'
  >('prompt');
  const [locationPermissionNotice, setLocationPermissionNotice] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return;
    }
    let permissionStatus: PermissionStatus | null = null;
    try {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          permissionStatus = status;
          setLocationPermissionState(
            status.state as 'granted' | 'prompt' | 'denied'
          );
          status.onchange = () => {
            setLocationPermissionState(
              status.state as 'granted' | 'prompt' | 'denied'
            );
          };
        })
        .catch(() => {
          // ignore unsupported
        });
    } catch {
      // safe fallback
    }

    return () => {
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  const handleToggleLocationPermission = () => {
    setLocationPermissionNotice(null);
    if (locationPermissionState === 'granted') {
      setLocationPermissionNotice('Location access is enabled in your browser.');
      return;
    }

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocationPermissionNotice('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationPermissionState('granted');
        setLocationPermissionNotice('Location access granted successfully!');
      },
      (err) => {
        if (err.code === 1 || /denied|permission/i.test(err.message || '')) {
          setLocationPermissionState('denied');
          setLocationPermissionNotice(
            'Blocked by browser settings — enable Location for this site in your browser’s address bar or device settings'
          );
        } else {
          setLocationPermissionNotice(
            err.message || 'Unable to retrieve location.'
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedLangCode(locale);
    });
  }, [locale]);

  const activeLocalities = useMemo(
    () => configLocalities.filter((loc) => loc.is_active),
    [configLocalities]
  );

  // Hydrate saved default locality from localStorage or Supabase profile
  useEffect(() => {
    if (typeof window === 'undefined') return;
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY_DEFAULT_LOCALITY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            id?: string | null;
            slug?: string | null;
            display_name?: string;
            hub_id?: string | null;
          };
          if (
            parsed?.display_name &&
            (!parsed.hub_id || parsed.hub_id === activeHub?.id)
          ) {
            setDefaultLocalitySelection({
              id: parsed.id || null,
              slug: parsed.slug || null,
              display_name: parsed.display_name,
            });
            return;
          }
        }
      } catch {
        // ignore parse errors
      }
      // Match by coordinates if available
      const matchedHubLoc = hubLocalities.find(
        (loc) =>
          loc.lat !== null &&
          loc.lng !== null &&
          Math.abs(loc.lat - effectiveDefaultCenter.lat) < 0.004 &&
          Math.abs(loc.lng - effectiveDefaultCenter.lng) < 0.004
      );
      if (matchedHubLoc) {
        setDefaultLocalitySelection({
          id: matchedHubLoc.id,
          slug: matchedHubLoc.slug,
          display_name: matchedHubLoc.display_name,
          lat: matchedHubLoc.lat,
          lng: matchedHubLoc.lng,
        });
      } else {
        setDefaultLocalitySelection(null);
      }
    });
  }, [
    activeHub?.id,
    hubLocalities,
    effectiveDefaultCenter.lat,
    effectiveDefaultCenter.lng,
  ]);

  const hubSelectOptions = useMemo(() => {
    const activeOptions = hubs
      .filter((h) => h.status === 'active')
      .map((h) => ({
        value: h.slug,
        label: `${h.name} (${h.state})`,
        description: `Service radius: ${h.service_radius_km} km · Languages: ${h.supported_languages.join(', ')}`,
      }));

    const comingSoonOptions = hubs
      .filter((h) => h.status === 'coming_soon')
      .map((h) => ({
        value: `__coming_soon__:${h.slug}`,
        label: `${h.name} (${h.state}) [Coming Soon]`,
        description: 'Expansion planned · Click to register interest',
      }));

    const requestOption = {
      value: '__request_new_hub__',
      label: '➕ Request a New Hub / City',
      description: 'Suggest your town or city for PrintSwift Local expansion',
    };

    return [...activeOptions, ...comingSoonOptions, requestOption];
  }, [hubs]);

  const activeHubSupportedLanguages = activeHub?.supported_languages;
  const activeHubName = activeHub?.name || 'your hub';

  const hubSupportedSet = useMemo(() => {
    const list = Array.isArray(activeHubSupportedLanguages)
      ? activeHubSupportedLanguages
      : ['en'];
    return new Set(list.map((l) => l.trim().toLowerCase()));
  }, [activeHubSupportedLanguages]);

  const prioritizedLanguageOptions = useMemo(() => {
    const mapped = BASE_LANGUAGE_CATALOG.map((item) => {
      const isRecommended = item.aliases.some((a) => hubSupportedSet.has(a));
      return {
        value: item.value,
        baseLocale: item.baseLocale,
        isRecommended,
        label: isRecommended ? `${item.label} ★` : item.label,
        description: isRecommended
          ? `Recommended for ${activeHubName}`
          : 'Regional platform language',
      };
    });
    return mapped.sort(
      (a, b) => Number(b.isRecommended) - Number(a.isRecommended)
    );
  }, [activeHubName, hubSupportedSet]);

  const recommendedLanguageLabels = useMemo(() => {
    return prioritizedLanguageOptions
      .filter((opt) => opt.isRecommended)
      .map((opt) => opt.label.replace(/\s*★$/, ''));
  }, [prioritizedLanguageOptions]);

  const localitySelectOptions = useMemo(
    () =>
      activeLocalities.map((loc) => ({
        value: loc.slug,
        label: loc.display_name,
        description: `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`,
      })),
    [activeLocalities]
  );

  const selectedLocalitySlug = useMemo(() => {
    const match = activeLocalities.find(
      (loc) =>
        Math.abs(loc.lat - effectiveDefaultCenter.lat) < 0.004 &&
        Math.abs(loc.lng - effectiveDefaultCenter.lng) < 0.004
    );
    return match?.slug || '';
  }, [activeLocalities, effectiveDefaultCenter.lat, effectiveDefaultCenter.lng]);

  const handleChangeHomeHub = async (hubSlug: string) => {
    if (hubSlug === '__request_new_hub__') {
      setUnifiedHubInitialView('request');
      setUnifiedHubPrefill({ city: '', state: '' });
      setIsUnifiedHubModalOpen(true);
      return;
    }

    if (hubSlug.startsWith('__coming_soon__:')) {
      const slug = hubSlug.replace('__coming_soon__:', '');
      const comingSoonHub = hubs.find(
        (h) => h.slug.toLowerCase() === slug.toLowerCase()
      );
      setUnifiedHubInitialView('request');
      setUnifiedHubPrefill({
        city: comingSoonHub?.name || '',
        state: comingSoonHub?.state || '',
      });
      setIsUnifiedHubModalOpen(true);
      return;
    }

    const targetHub = hubs.find(
      (h) => h.slug.toLowerCase() === hubSlug.toLowerCase()
    );
    if (!targetHub || targetHub.status !== 'active') return;

    await switchHub(targetHub.slug);
    setDefaultLocalitySelection(null);
    await updateDefaultMapLocation(
      { lat: targetHub.center_lat, lng: targetHub.center_lng },
      targetHub.default_zoom || 14
    );

    const activeUserId =
      session?.user?.id || storeSession?.user?.id || storeUser?.id || '';
    if (activeUserId && isSupabaseConfigured()) {
      setStatus('saving', 'Saving home hub');
      try {
        await supabase
          .from('profiles')
          .update({
            default_hub_id: targetHub.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeUserId);
        setAuthStoreState({ defaultHubId: targetHub.id });
        setStatus('success', 'Home hub saved');
      } catch {
        setStatus('error', 'Failed to sync profile hub');
      }
    }

    setHubSaveFeedback(
      `Active & Default Home Hub updated to ${targetHub.name} (${targetHub.state}).`
    );
  };

  const handleSelectHubDefaultLocality = async (loc: LocalitySelection) => {
    if (!loc.display_name) {
      setDefaultLocalitySelection(null);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(STORAGE_KEY_DEFAULT_LOCALITY);
        } catch {
          // ignore storage error
        }
      }
      return;
    }

    setDefaultLocalitySelection(loc);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          STORAGE_KEY_DEFAULT_LOCALITY,
          JSON.stringify({
            id: loc.id || null,
            slug: loc.slug || null,
            display_name: loc.display_name,
            hub_id: activeHub?.id || null,
          })
        );
      } catch {
        // ignore storage error
      }
    }

    if (
      typeof loc.lat === 'number' &&
      typeof loc.lng === 'number' &&
      Number.isFinite(loc.lat) &&
      Number.isFinite(loc.lng)
    ) {
      await updateDefaultMapLocation({ lat: loc.lat, lng: loc.lng }, 15);
    }

    const activeUserId =
      session?.user?.id || storeSession?.user?.id || storeUser?.id || '';
    if (activeUserId && isSupabaseConfigured() && loc.id) {
      setStatus('saving', 'Saving default locality');
      try {
        const { error: errWithDefaultLoc } = await supabase
          .from('profiles')
          .update({
            default_locality_id: loc.id,
            locality_id: loc.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeUserId);

        if (errWithDefaultLoc) {
          await supabase
            .from('profiles')
            .update({
              locality_id: loc.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', activeUserId);
        }
        setStatus('success', 'Default locality saved');
      } catch {
        setStatus('error', 'Failed to sync locality');
      }
    }

    setHubSaveFeedback(
      `Default locality set to ${loc.display_name} (${activeHub?.name || 'Hub'}).`
    );
  };

  const handleSelectPreferredLocality = async (slug: string) => {
    const chosen = activeLocalities.find((loc) => loc.slug === slug);
    if (!chosen) return;
    await updateDefaultMapLocation(
      { lat: chosen.lat, lng: chosen.lng },
      14
    );
    setGpsStatusMessage({
      type: 'success',
      text: `Default map center set to ${chosen.display_name} (${chosen.lat.toFixed(4)}, ${chosen.lng.toFixed(4)}).`,
    });
  };

  const supportWaDigits = sanitizePhoneForWhatsApp(office.whatsapp || office.phone || '');
  const supportWaHref = supportWaDigits
    ? `https://wa.me/${supportWaDigits}?text=${encodeURIComponent(
        'Hi PrintSwift Local Support, I need help with my account or bookings.'
      )}`
    : null;

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
        <div className="sticky top-[60px] md:top-[64px] z-20 -mx-2 px-2 py-2.5 bg-white/85 dark:bg-slate-950/85 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 flex flex-wrap items-center justify-between gap-3">
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

        {/* Phase 68-A: Service Hub & Locality Card */}
        <section
          data-testid="settings-service-hub-locality-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-theme-primary" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Service Hub &amp; Locality
              </h2>
            </div>
            <span
              data-testid="settings-active-hub-badge"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/12 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Active: {activeHub.name} Hub</span>
            </span>
          </div>

          <p className="text-xs text-[var(--ps-text-muted)]">
            Set your default regional service hub and preferred neighborhood so Explore maps, Pick N Drop rates, and local bulletins open directly in your town.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <CustomSelectModal
                id="settings-home-hub-select"
                testId="settings-home-hub-select"
                label="Active / Default Home Hub"
                value={activeHub.slug}
                options={hubSelectOptions}
                placeholder="Select Service Hub"
                onChange={(slug) => void handleChangeHomeHub(slug)}
              />
            </div>

            <div>
              <LocalityCombobox
                id="settings-default-locality-combobox"
                hubId={activeHub.id}
                allowCreate={false}
                label={`Default Locality (${activeHub.name})`}
                placeholder={`Choose verified locality in ${activeHub.name}…`}
                value={
                  defaultLocalitySelection
                    ? {
                        id: defaultLocalitySelection.id,
                        display_name: defaultLocalitySelection.display_name,
                      }
                    : null
                }
                onSelect={(loc) => void handleSelectHubDefaultLocality(loc)}
                onClear={() =>
                  void handleSelectHubDefaultLocality({
                    id: null,
                    display_name: '',
                  })
                }
              />
            </div>
          </div>

          {hubSaveFeedback && (
            <div
              role="status"
              data-testid="settings-hub-save-feedback"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              {hubSaveFeedback}
            </div>
          )}
        </section>

        {/* Language & Localization Selector (CustomSelectModal) */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                {t('languageSectionTitle')}
              </h2>
            </div>
            {recommendedLanguageLabels.length > 0 && (
              <span
                data-testid="settings-hub-recommended-languages-badge"
                className="rounded-lg border border-theme-primary/30 bg-theme-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-theme-primary"
              >
                Recommended for {activeHub.name}:{' '}
                {recommendedLanguageLabels.join(', ')}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            {t('languageDescription')}
          </p>

          <div className="max-w-sm">
            <CustomSelectModal
              id="settings-language-select"
              testId="settings-language-select"
              label={t('languageLabel')}
              value={selectedLangCode}
              options={prioritizedLanguageOptions}
              placeholder="Select language"
              onChange={(val) => {
                setSelectedLangCode(val);
                const matched = BASE_LANGUAGE_CATALOG.find(
                  (item) => item.value === val
                );
                updateLocale((matched?.baseLocale || 'en') as SupportedLocale);
              }}
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

        {/* Phase 61-D: Unified "Theme & Appearance" Card (Light/Dark/System + 5 Renovated 3-Dot Presets + Integrated Fine-Tune Custom Palette) */}
        <section
          data-testid="settings-theme-appearance-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 space-y-4"
        >
          {/* Top Row: Title + Compact Reset */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-theme-primary" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Theme &amp; Appearance
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                resetThemeToDefault();
                resetThemeScale();
              }}
              data-testid="settings-reset-custom-colors-btn"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Appearance Mode Segmented Toggle */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1">
            {(['light', 'dark', 'system'] as AppearanceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => updateAppearanceMode(mode)}
                className={`h-8 rounded-lg px-3 text-xs font-bold capitalize transition cursor-pointer ${
                  appearanceMode === mode
                    ? 'bg-theme-primary text-[hsl(var(--color-primary-foreground))] shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Middle Section: 5 Renovated 3-Color Presets */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--ps-text)]">
                Curated Palettes
              </span>
              <span className="text-[11px] text-[var(--ps-text-muted)]">
                Drives Primary, Secondary &amp; Accent tokens
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {THEME_PRESETS.map((preset) => {
                const isSelected = activePreset === preset.id;
                const primaryHex = hslToHex(preset.colors.primary, '#131c31');
                const secondaryHex = hslToHex(
                  preset.colors.secondary,
                  '#f2f5f8'
                );
                const accentHex = hslToHex(preset.colors.accent, '#2563eb');

                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`theme-preset-${preset.id}`}
                    onClick={() => selectColorPreset(preset.id)}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-theme-primary bg-theme-primary/[0.05] dark:bg-theme-primary/[0.12] ring-1 ring-theme-primary/30'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-theme-primary/40'
                    }`}
                  >
                    {/* 3-Dot Swatch */}
                    <div
                      className="mt-0.5 flex items-center -space-x-1 shrink-0"
                      aria-hidden="true"
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-white dark:border-slate-900 shadow-xs"
                        style={{ backgroundColor: primaryHex }}
                      />
                      <span
                        className="h-4 w-4 rounded-full border border-slate-300 dark:border-slate-700 shadow-xs"
                        style={{ backgroundColor: secondaryHex }}
                      />
                      <span
                        className="h-4 w-4 rounded-full border border-white dark:border-slate-900 shadow-xs"
                        style={{ backgroundColor: accentHex }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                          {preset.name}
                        </span>
                        {isSelected && (
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-theme-primary text-[hsl(var(--color-primary-foreground))]">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-[var(--ps-text-muted)]">
                        {preset.tagline}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Section: Integrated Fine-Tune Custom Palette Bar */}
          <div
            data-testid="settings-custom-colors-section"
            className={`rounded-xl p-3.5 space-y-3 transition-all ${
              activePreset === 'custom'
                ? 'border-2 border-theme-primary ring-2 ring-theme-primary/20 bg-theme-primary/[0.04] dark:bg-theme-primary/10 shadow-sm'
                : 'border border-[var(--ps-border)] bg-[var(--ps-bg)]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-[var(--ps-text)]">
                  Fine-Tune Custom Palette
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Adjust any swatch to personalize your interface in real time.
                </p>
              </div>
              {activePreset === 'custom' ? (
                <span
                  data-testid="settings-custom-palette-badge"
                  className="inline-flex items-center gap-1 rounded-full bg-theme-primary text-theme-primary-foreground px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider shadow-xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  <span>ACTIVE • CUSTOM</span>
                </span>
              ) : (
                <span
                  data-testid="settings-custom-palette-badge"
                  className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                >
                  CUSTOM
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    tier: 'primary' as const,
                    label: 'Primary',
                    fallback: '#131c31',
                    testId: 'color-picker-primary',
                  },
                  {
                    tier: 'secondary' as const,
                    label: 'Secondary Tint',
                    fallback: '#f2f5f8',
                    testId: 'color-picker-secondary',
                  },
                  {
                    tier: 'accent' as const,
                    label: 'Accent',
                    fallback: '#2563eb',
                    testId: 'color-picker-accent',
                  },
                ] as const
              ).map((item) => {
                const hexCode = hslToHex(
                  themeColors[item.tier],
                  item.fallback
                ).toUpperCase();
                return (
                  <label
                    key={item.tier}
                    className="flex items-center justify-between gap-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 cursor-pointer hover:border-theme-primary/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--ps-text)] truncate">
                        {item.label}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--ps-text-muted)]">
                        {hexCode}
                      </div>
                    </div>
                    <input
                      type="color"
                      aria-label={item.label}
                      data-testid={item.testId}
                      value={hexCode.toLowerCase()}
                      onChange={(e) =>
                        updateColorTier(item.tier, e.target.value)
                      }
                      className="h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-slate-300 dark:border-slate-700 p-0"
                    />
                  </label>
                );
              })}
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
            {/* Location Permission Control */}
            <div
              onClick={handleToggleLocationPermission}
              className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 cursor-pointer hover:border-theme-primary/40 transition-colors"
            >
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-2">
                  <span>Location Permission</span>
                  {locationPermissionState === 'granted' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      <Check className="h-2.5 w-2.5" />
                      <span>Enabled</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  {locationPermissionState === 'granted'
                    ? 'Location access is enabled for map routing and nearest hub detection.'
                    : locationPermissionState === 'denied'
                      ? 'Location access is blocked by your browser settings.'
                      : 'Allow browser access to your device location for GPS discovery.'}
                </p>
                {locationPermissionNotice && (
                  <p
                    className={`text-[11px] font-medium pt-1 ${
                      locationPermissionState === 'denied'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {locationPermissionNotice}
                  </p>
                )}
              </div>
              <input
                type="checkbox"
                checked={locationPermissionState === 'granted'}
                onChange={handleToggleLocationPermission}
                aria-label="Toggle Location Permission"
                className="h-4 w-4 accent-[var(--ps-accent)] cursor-pointer"
              />
            </div>

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

            {/* Phase 53-B & 65-C: Default Map Center + Dynamic Locality Selector */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-xs space-y-4">
              <div className="flex items-center gap-2">
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

              {localitySelectOptions.length > 0 && (
                <div className="space-y-1.5">
                  <CustomSelectModal
                    label="Preferred Default Locality"
                    placeholder="Choose a Churachandpur neighborhood…"
                    options={localitySelectOptions}
                    value={selectedLocalitySlug}
                    onChange={(slug) => void handleSelectPreferredLocality(slug)}
                    testId="settings-preferred-locality-select"
                  />
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Quickly snap your default Explore map view to any active district locality.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3">
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

          <UnifiedHubModal
            open={isUnifiedHubModalOpen}
            onClose={() => setIsUnifiedHubModalOpen(false)}
            initialView={unifiedHubInitialView}
            initialCity={unifiedHubPrefill.city}
            initialState={unifiedHubPrefill.state}
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

        {/* Phase 65-C: Account, Payments & Legal Footer Section */}
        <section
          data-testid="settings-account-payments-legal-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Account, Payments &amp; Legal
              </h2>
            </div>
            {supportWaHref && (
              <a
                href={supportWaHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="settings-support-whatsapp-btn"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white transition-colors"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>Support WhatsApp</span>
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Link
              href="/activity?tab=payments"
              className="flex items-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <Receipt className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
              <span>Payment Receipts &amp; History</span>
            </Link>
            <Link
              href="/saved?tab=interests"
              className="flex items-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <Bookmark className="h-4 w-4 text-amber-500 shrink-0" />
              <span>Saved Interests &amp; Follows</span>
            </Link>
            <Link
              href="/about"
              className="flex items-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <Info className="h-4 w-4 text-sky-500 shrink-0" />
              <span>About &amp; District Office</span>
            </Link>
          </div>

          {/* Phase 71-D: Document Privacy & 48h Auto-Purge Info Row */}
          <div
            data-testid="settings-document-privacy-purge-row"
            className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3.5 py-2.5 text-xs"
          >
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 space-y-0.5">
              <p className="font-bold text-[var(--ps-text)]">
                Document Privacy &amp; 48h Auto-Purge
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--ps-text-muted)]">
                Uploaded print PDFs and phone photos are stored privately with
                random non-PII storage keys, shared with your selected shop only
                via short-lived signed links, and automatically erased 48 hours
                after collection.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--ps-border)] pt-3 text-xs font-medium text-[var(--ps-text-muted)]">
            <Link
              href="/legal/terms"
              className="inline-flex items-center gap-1.5 hover:text-[var(--ps-accent)]"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Terms of Service</span>
            </Link>
            <Link
              href="/legal/privacy"
              className="inline-flex items-center gap-1.5 hover:text-[var(--ps-accent)]"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Privacy Policy</span>
            </Link>
            <Link
              href="/legal/refund-policy"
              className="inline-flex items-center gap-1.5 hover:text-[var(--ps-accent)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Refund Policy</span>
            </Link>
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
