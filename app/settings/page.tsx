'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Compass,
  Globe,
  Map,
  Palette,
  RotateCcw,
  Ruler,
  Sliders,
} from 'lucide-react';
import {
  AppProvider,
  useAppStore,
  useRealEstateMode,
  useSimpleMode,
} from '@/lib/store';
import { AreaUnit, AppearanceMode, MapStyleOption } from '@/lib/types';
import enMessages from '@/messages/en.json';
import mniMessages from '@/messages/mni.json';
import paiteMessages from '@/messages/paite.json';

type SupportedLocale = 'en' | 'mni' | 'paite';

const LOCALE_STORAGE_KEY = 'printswift_local_locale_v1';

const LOCALE_OPTIONS: Array<{ code: SupportedLocale; label: string }> = [
  { code: 'en', label: 'English (en)' },
  { code: 'mni', label: 'Manipuri (mni)' },
  { code: 'paite', label: 'Paite (paite)' },
];

const MESSAGES_MAP: Record<SupportedLocale, typeof enMessages> = {
  en: enMessages,
  mni: mniMessages,
  paite: paiteMessages,
};

function SettingsContent({
  locale,
  onChangeLocale,
}: {
  locale: SupportedLocale;
  onChangeLocale: (nextLocale: SupportedLocale) => void;
}) {
  const t = useTranslations('Settings');
  const {
    appearanceMode,
    setAppearanceMode,
    mapStyle,
    setMapStyle,
    areaUnit,
    setAreaUnit,
    effectiveDefaultCenter,
    resetCustomDefaultCenter,
    resetThemeToDefault,
  } = useAppStore();
  const [simpleMode, setSimpleMode] = useSimpleMode();
  const [realEstateMode, setRealEstateMode] = useRealEstateMode();

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Discovery Map</span>
          </Link>

          <div className="flex items-center gap-3 text-xs font-semibold">
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

        {/* Language & Localization Selector */}
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

          <div className="max-w-sm space-y-1.5">
            <label
              htmlFor="settings-language-select"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              {t('languageLabel')}
            </label>
            <select
              id="settings-language-select"
              data-testid="settings-language-select"
              value={locale}
              onChange={(e) =>
                onChangeLocale(e.target.value as SupportedLocale)
              }
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Theme & Appearance */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                {t('appearanceTitle')}
              </h2>
            </div>
            <button
              type="button"
              onClick={resetThemeToDefault}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t('resetTheme')}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {(['light', 'dark', 'system'] as AppearanceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAppearanceMode(mode)}
                className={`rounded-xl border px-3 py-2.5 text-xs font-bold capitalize transition ${
                  appearanceMode === mode
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </section>

        {/* Default Map Behaviors */}
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
                  Simple Mode (Hide Advanced Draw & Measure Tools)
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Keeps the map toolbar minimal for everyday browsing.
                </p>
              </div>
              <input
                type="checkbox"
                checked={simpleMode}
                onChange={(e) => setSimpleMode(e.target.checked)}
                aria-label="Toggle Simple Mode"
                className="h-4 w-4 accent-[var(--ps-accent)]"
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
                onChange={(e) => setRealEstateMode(e.target.checked)}
                aria-label="Toggle Real Estate Mode"
                className="h-4 w-4 accent-[var(--ps-accent)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 pt-1">
              {(['roadmap', 'dark', 'satellite', 'hybrid'] as MapStyleOption[]).map(
                (style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setMapStyle(style)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                      mapStyle === style
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                    }`}
                  >
                    Map: {style}
                  </button>
                )
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-xs">
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>
                  Default Map Centre:{' '}
                  <strong className="font-mono">
                    {effectiveDefaultCenter.lat.toFixed(4)},{' '}
                    {effectiveDefaultCenter.lng.toFixed(4)}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={resetCustomDefaultCenter}
                className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)]"
              >
                Reset to Churachandpur Centre
              </button>
            </div>
          </div>
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
                onClick={() => setAreaUnit(unit.id)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
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
      </div>
    </main>
  );
}

export default function SettingsPage() {
  const [locale, setLocale] = useState<SupportedLocale>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'en' || saved === 'mni' || saved === 'paite') {
        queueMicrotask(() => setLocale(saved));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleChangeLocale = (nextLocale: SupportedLocale) => {
    setLocale(nextLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // ignore storage errors
    }
  };

  return (
    <AppProvider>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES_MAP[locale]}
      >
        <SettingsContent
          locale={locale}
          onChangeLocale={handleChangeLocale}
        />
      </NextIntlClientProvider>
    </AppProvider>
  );
}

