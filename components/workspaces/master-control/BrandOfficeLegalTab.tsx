'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  LocateFixed,
  Megaphone,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import {
  extractSvgValidationError,
  sanitizeSvgMarkup,
} from '@/lib/brand/sanitize-svg';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { uploadImage } from '@/lib/supabase/storage';
import {
  normalizeAppIdentity,
  normalizeLegalPages,
  normalizeOfficeAndContact,
  type AnnouncementVariant,
  type AppIdentityConfig,
  type BrandLogoMode,
  type LegalPagesConfig,
  type OfficeAndContactConfig,
} from '@/lib/config/types';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

interface BrandOfficeLegalTabProps extends MasterControlTabSharedProps {
  initialIdentity: AppIdentityConfig;
  initialOffice: OfficeAndContactConfig;
  initialLegal: LegalPagesConfig;
}

type LegalEditorTab = 'terms_md' | 'privacy_md' | 'refund_policy_md';

export function BrandOfficeLegalTab({
  initialIdentity,
  initialOffice,
  initialLegal,
  onSavePlatformSetting,
  onNotify,
}: BrandOfficeLegalTabProps) {
  const [identityForm, setIdentityForm] = useState<AppIdentityConfig>(() =>
    normalizeAppIdentity(initialIdentity)
  );
  const [officeForm, setOfficeForm] = useState<OfficeAndContactConfig>(() =>
    normalizeOfficeAndContact(initialOffice)
  );
  const [legalForm, setLegalForm] = useState<LegalPagesConfig>(() =>
    normalizeLegalPages(initialLegal)
  );

  const [activeLegalTab, setActiveLegalTab] =
    useState<LegalEditorTab>('terms_md');
  const [savingSection, setSavingSection] = useState<
    'identity' | 'office' | 'legal' | null
  >(null);
  const [uploadingLogo, setUploadingLogo] = useState<'light' | 'dark' | null>(
    null
  );
  const [locatingGps, setLocatingGps] = useState(false);
  const [svgUploadError, setSvgUploadError] = useState<string | null>(null);
  const [confirmSaveIdentityOpen, setConfirmSaveIdentityOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setIdentityForm(normalizeAppIdentity(initialIdentity));
    });
  }, [initialIdentity]);

  useEffect(() => {
    queueMicrotask(() => {
      setOfficeForm(normalizeOfficeAndContact(initialOffice));
    });
  }, [initialOffice]);

  useEffect(() => {
    queueMicrotask(() => {
      setLegalForm(normalizeLegalPages(initialLegal));
    });
  }, [initialLegal]);

  const handleLogoUpload = async (
    variant: 'light' | 'dark',
    file: File | undefined
  ) => {
    if (!file) return;
    setUploadingLogo(variant);
    setAppStatus('saving', `Uploading ${variant} logo…`);
    try {
      const uploaded = await uploadImage(file, {
        folder: 'profiles',
        entityId: `brand-logo-${variant}`,
      });
      setIdentityForm((prev) => ({
        ...prev,
        logo_mode: 'image_url',
        logo_light_url:
          variant === 'light' ? uploaded.publicUrl : prev.logo_light_url,
        logo_dark_url:
          variant === 'dark' ? uploaded.publicUrl : prev.logo_dark_url,
      }));
      setAppStatus('success', 'Logo uploaded (click Save Brand & Logo Changes)');
      onNotify?.({
        type: 'info',
        text: `Uploaded ${variant} logo. Click "Save Brand & Logo Changes" to publish.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to upload logo image.';
      setAppStatus('error', 'Logo upload failed');
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setUploadingLogo(null);
    }
  };

  const handleSvgFilePick = async (
    target: 'custom_icon_svg' | 'custom_logo_svg',
    file: File | undefined
  ) => {
    if (!file) return;
    setSvgUploadError(null);
    if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') {
      const msg = 'Please select a valid .svg vector file.';
      setSvgUploadError(msg);
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
      return;
    }
    try {
      const rawText = await file.text();
      const validationErr = extractSvgValidationError(rawText);
      if (validationErr) {
        setSvgUploadError(validationErr);
        setAppStatus('error', 'SVG validation failed');
        onNotify?.({ type: 'error', text: validationErr });
        return;
      }
      const sanitized = sanitizeSvgMarkup(rawText);
      if (!sanitized) {
        const msg = 'SVG markup could not be safely sanitized.';
        setSvgUploadError(msg);
        setAppStatus('error', msg);
        onNotify?.({ type: 'error', text: msg });
        return;
      }
      setIdentityForm((prev) => ({
        ...prev,
        logo_mode: 'svg',
        [target]: sanitized,
      }));
      setAppStatus('success', 'SVG sanitized & ready to save');
      onNotify?.({
        type: 'info',
        text: 'SVG file sanitized. Click "Save Brand & Logo Changes" to publish live.',
      });
    } catch {
      const msg = 'Unable to read the selected SVG file.';
      setSvgUploadError(msg);
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    }
  };

  const handleUseCurrentGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onNotify?.({
        type: 'error',
        text: 'Browser geolocation is not supported on this device.',
      });
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOfficeForm((prev) => ({
          ...prev,
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        }));
        setLocatingGps(false);
        setAppStatus('success', 'Office GPS captured');
      },
      (err) => {
        setLocatingGps(false);
        onNotify?.({
          type: 'error',
          text: err.message || 'Unable to fetch current GPS coordinates.',
        });
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const executeSaveIdentity = async () => {
    if (identityForm.logo_mode === 'svg') {
      const rawIcon = identityForm.custom_icon_svg?.trim() || '';
      const rawFull = identityForm.custom_logo_svg?.trim() || '';
      if (!rawIcon && !rawFull) {
        const msg = 'Paste or upload at least one valid SVG (Icon or Full Logo), or switch logo mode.';
        setSvgUploadError(msg);
        setAppStatus('error', 'Missing custom SVG');
        onNotify?.({ type: 'error', text: msg });
        return;
      }
      if (rawIcon && !sanitizeSvgMarkup(rawIcon)) {
        const msg = extractSvgValidationError(rawIcon) || 'Icon SVG markup is invalid.';
        setSvgUploadError(msg);
        setAppStatus('error', 'Invalid Icon SVG');
        onNotify?.({ type: 'error', text: msg });
        return;
      }
      if (rawFull && !sanitizeSvgMarkup(rawFull)) {
        const msg = extractSvgValidationError(rawFull) || 'Full Logo SVG markup is invalid.';
        setSvgUploadError(msg);
        setAppStatus('error', 'Invalid Full Logo SVG');
        onNotify?.({ type: 'error', text: msg });
        return;
      }
    }

    setSvgUploadError(null);
    setConfirmSaveIdentityOpen(false);
    setSavingSection('identity');
    const normalized = normalizeAppIdentity(identityForm);
    setIdentityForm(normalized);
    await onSavePlatformSetting(
      'app_identity',
      normalized,
      'Brand identity, logos, and global announcement strip updated.'
    );
    setSavingSection(null);
  };

  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    const initialNormalized = normalizeAppIdentity(initialIdentity);
    const hadActiveCustomLogo =
      initialNormalized.logo_mode !== 'default' ||
      Boolean(
        initialNormalized.custom_icon_svg ||
          initialNormalized.custom_logo_svg ||
          initialNormalized.logo_light_url ||
          initialNormalized.logo_dark_url ||
          initialNormalized.logo_url
      );
    const logoChanged =
      initialNormalized.logo_mode !== identityForm.logo_mode ||
      (initialNormalized.custom_icon_svg || '') !== (identityForm.custom_icon_svg || '') ||
      (initialNormalized.custom_logo_svg || '') !== (identityForm.custom_logo_svg || '') ||
      (initialNormalized.logo_light_url || '') !== (identityForm.logo_light_url || '') ||
      (initialNormalized.logo_dark_url || '') !== (identityForm.logo_dark_url || '') ||
      (initialNormalized.logo_url || '') !== (identityForm.logo_url || '');

    if (hadActiveCustomLogo && logoChanged) {
      setConfirmSaveIdentityOpen(true);
      return;
    }
    void executeSaveIdentity();
  };

  const handleSaveOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSection('office');
    const normalized = normalizeOfficeAndContact(officeForm);
    setOfficeForm(normalized);
    await onSavePlatformSetting(
      'office_and_contact',
      normalized,
      'District office address, GPS coordinates, and support channels saved.'
    );
    setSavingSection(null);
  };

  const handleSaveLegal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSection('legal');
    const nextLegal: LegalPagesConfig = {
      ...normalizeLegalPages(legalForm),
      updated_at: new Date().toISOString(),
    };
    setLegalForm(nextLegal);
    await onSavePlatformSetting(
      'legal_pages',
      nextLegal,
      'Legal policies updated and published live.'
    );
    setSavingSection(null);
  };

  const legalPreviewHref =
    activeLegalTab === 'terms_md'
      ? '/legal/terms'
      : activeLegalTab === 'privacy_md'
        ? '/legal/privacy'
        : '/legal/refund-policy';

  return (
    <div className="space-y-4">
      {/* 1. Brand Identity & Global Announcement Strip */}
      <form
        onSubmit={handleSaveIdentity}
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[var(--ps-accent)]" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              Brand Identity &amp; Logos
            </h3>
          </div>
          <button
            type="submit"
            disabled={savingSection !== null}
            data-testid="save-brand-identity-btn"
            className="h-9 px-3.5 rounded-xl bg-theme-primary text-theme-primary-foreground text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60 cursor-pointer"
          >
            {savingSection === 'identity' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save Brand &amp; Logo Changes</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              App Name
            </label>
            <input
              type="text"
              value={identityForm.app_name}
              onChange={(e) =>
                setIdentityForm((p) => ({ ...p, app_name: e.target.value }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Short Name (Header)
            </label>
            <input
              type="text"
              value={identityForm.short_name}
              onChange={(e) =>
                setIdentityForm((p) => ({ ...p, short_name: e.target.value }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Tagline
            </label>
            <input
              type="text"
              value={identityForm.tagline}
              onChange={(e) =>
                setIdentityForm((p) => ({ ...p, tagline: e.target.value }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>
        </div>

        {/* Brand Logo Engine Selector (Default Vector / Custom SVG / Image URL) */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-[var(--ps-text)]">
                Brand Logo Source
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Controls Splash Screen, Top Header, Hub Selector &amp; Loaders globally
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-1 gap-1">
              {(
                [
                  { id: 'default', label: 'Default DD oodle Vector' },
                  { id: 'svg', label: 'Custom SVG' },
                  { id: 'image_url', label: 'Image URL' },
                ] as Array<{ id: BrandLogoMode; label: string }>
              ).map((modeOpt) => {
                const active = (identityForm.logo_mode ?? 'default') === modeOpt.id;
                return (
                  <button
                    key={modeOpt.id}
                    type="button"
                    data-testid={`brand-logo-mode-${modeOpt.id}`}
                    onClick={() => {
                      setSvgUploadError(null);
                      setIdentityForm((prev) => ({
                        ...prev,
                        logo_mode: modeOpt.id,
                      }));
                    }}
                    className={`h-8 px-2.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      active
                        ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    {modeOpt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Instant Light & Dark Brand Logo Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Light Mode Live Preview
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <DDoodleLogo
                  variant="full"
                  size={34}
                  showTagline
                  overrideIdentity={identityForm}
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shrink-0">
                  <DDoodleLogo
                    variant="icon"
                    size={24}
                    overrideIdentity={identityForm}
                  />
                </div>
              </div>
            </div>
            <div className="dark rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Dark Mode Live Preview
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <DDoodleLogo
                  variant="full"
                  size={34}
                  showTagline
                  overrideIdentity={identityForm}
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 shrink-0">
                  <DDoodleLogo
                    variant="icon"
                    size={24}
                    overrideIdentity={identityForm}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Mode: Custom SVG Upload / Paste */}
          {identityForm.logo_mode === 'svg' && (
            <div className="space-y-3 pt-1">
              {svgUploadError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{svgUploadError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Icon / Mark SVG */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5 text-theme-primary" />
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        Icon Mark SVG (Square)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold text-[var(--ps-text)] hover:border-theme-primary inline-flex items-center gap-1 cursor-pointer">
                        <Upload className="w-3 h-3" />
                        <span>Upload .svg</span>
                        <input
                          type="file"
                          accept=".svg,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            void handleSvgFilePick('custom_icon_svg', e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {identityForm.custom_icon_svg && (
                        <button
                          type="button"
                          onClick={() =>
                            setIdentityForm((prev) => ({
                              ...prev,
                              custom_icon_svg: null,
                            }))
                          }
                          aria-label="Clear Icon SVG"
                          className="h-8 w-8 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={identityForm.custom_icon_svg || ''}
                    onChange={(e) => {
                      setSvgUploadError(null);
                      setIdentityForm((prev) => ({
                        ...prev,
                        custom_icon_svg: e.target.value || null,
                      }));
                    }}
                    placeholder='<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">...</svg>'
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 font-mono text-[11px] text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                  />
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {identityForm.custom_icon_svg?.trim() ? (
                      sanitizeSvgMarkup(identityForm.custom_icon_svg) ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Sanitized &amp; XSS-safe
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                          <AlertTriangle className="h-3 w-3" />
                          {extractSvgValidationError(identityForm.custom_icon_svg)}
                        </span>
                      )
                    ) : (
                      <span className="text-[var(--ps-text-muted)]">
                        Used in header badge, hub selector &amp; compact icons.
                      </span>
                    )}
                  </div>
                </div>

                {/* Full Horizontal Logo SVG */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5 text-theme-primary" />
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        Full Logo SVG (Optional)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold text-[var(--ps-text)] hover:border-theme-primary inline-flex items-center gap-1 cursor-pointer">
                        <Upload className="w-3 h-3" />
                        <span>Upload .svg</span>
                        <input
                          type="file"
                          accept=".svg,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            void handleSvgFilePick('custom_logo_svg', e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {identityForm.custom_logo_svg && (
                        <button
                          type="button"
                          onClick={() =>
                            setIdentityForm((prev) => ({
                              ...prev,
                              custom_logo_svg: null,
                            }))
                          }
                          aria-label="Clear Full Logo SVG"
                          className="h-8 w-8 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={identityForm.custom_logo_svg || ''}
                    onChange={(e) => {
                      setSvgUploadError(null);
                      setIdentityForm((prev) => ({
                        ...prev,
                        custom_logo_svg: e.target.value || null,
                      }));
                    }}
                    placeholder='<svg viewBox="0 0 220 48" xmlns="http://www.w3.org/2000/svg">...</svg>'
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 font-mono text-[11px] text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                  />
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {identityForm.custom_logo_svg?.trim() ? (
                      sanitizeSvgMarkup(identityForm.custom_logo_svg) ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Sanitized &amp; XSS-safe
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                          <AlertTriangle className="h-3 w-3" />
                          {extractSvgValidationError(identityForm.custom_logo_svg)}
                        </span>
                      )
                    ) : (
                      <span className="text-[var(--ps-text-muted)]">
                        Optional full wordmark lockup for Splash &amp; Hero banners.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mode: Image URL Uploaders */}
          {identityForm.logo_mode === 'image_url' && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['light', 'dark'] as const).map((variant) => {
                  const url =
                    variant === 'light'
                      ? identityForm.logo_light_url
                      : identityForm.logo_dark_url;
                  return (
                    <div
                      key={variant}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-10 h-10 rounded-xl border border-[var(--ps-border)] flex items-center justify-center overflow-hidden shrink-0 ${
                              variant === 'dark' ? 'bg-slate-900' : 'bg-white'
                            }`}
                          >
                            {url ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={url}
                                alt={`${variant} logo`}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-contain p-1"
                              />
                            ) : (
                              <ImagePlus className="w-4 h-4 text-[var(--ps-text-muted)]" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold capitalize text-[var(--ps-text)]">
                              {variant} Mode Logo
                            </div>
                            <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                              {url ? 'Custom image active' : 'No image URL set'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <label className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold text-[var(--ps-text)] hover:border-theme-primary inline-flex items-center gap-1 cursor-pointer">
                            {uploadingLogo === variant ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <ImagePlus className="w-3 h-3" />
                            )}
                            <span>Upload</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/svg+xml"
                              className="hidden"
                              onChange={(e) =>
                                void handleLogoUpload(variant, e.target.files?.[0])
                              }
                            />
                          </label>
                          {url && (
                            <button
                              type="button"
                              onClick={() =>
                                setIdentityForm((prev) => ({
                                  ...prev,
                                  logo_light_url:
                                    variant === 'light' ? null : prev.logo_light_url,
                                  logo_dark_url:
                                    variant === 'dark' ? null : prev.logo_dark_url,
                                }))
                              }
                              aria-label={`Clear ${variant} logo`}
                              className="h-8 w-8 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="url"
                        value={url || ''}
                        onChange={(e) =>
                          setIdentityForm((prev) => ({
                            ...prev,
                            logo_light_url:
                              variant === 'light'
                                ? e.target.value || null
                                : prev.logo_light_url,
                            logo_dark_url:
                              variant === 'dark'
                                ? e.target.value || null
                                : prev.logo_dark_url,
                          }))
                        }
                        placeholder={`https://… (${variant} logo image URL)`}
                        className="w-full h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] text-[var(--ps-text)]"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <ConfirmActionModal
          isOpen={confirmSaveIdentityOpen}
          title="Replace Active Brand Logo?"
          description="This will update the live DD oodle logo across the Splash Screen, Header, Hub Selector, and all user sessions immediately."
          confirmLabel="Publish Brand Changes"
          cancelLabel="Cancel"
          loading={savingSection === 'identity'}
          onConfirm={() => void executeSaveIdentity()}
          onCancel={() => setConfirmSaveIdentityOpen(false)}
        />

        {/* Global Announcement Strip */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
              <Megaphone className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              <span>Global Announcement Strip</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={identityForm.announcement_bar.enabled}
              onClick={() =>
                setIdentityForm((p) => ({
                  ...p,
                  announcement_bar: {
                    ...p.announcement_bar,
                    enabled: !p.announcement_bar.enabled,
                  },
                }))
              }
              className={`h-7 px-3 rounded-lg text-[11px] font-bold border transition-colors ${
                identityForm.announcement_bar.enabled
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-[var(--ps-surface)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
              }`}
            >
              {identityForm.announcement_bar.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-6">
              <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                Announcement Text
              </label>
              <input
                type="text"
                value={identityForm.announcement_bar.text}
                onChange={(e) =>
                  setIdentityForm((p) => ({
                    ...p,
                    announcement_bar: {
                      ...p.announcement_bar,
                      text: e.target.value,
                    },
                  }))
                }
                placeholder="e.g., Lamka Launch Offer: Use code LAMKA20 for ₹20 off Pick N Drop!"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs text-[var(--ps-text)]"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                Optional Link URL
              </label>
              <input
                type="text"
                value={identityForm.announcement_bar.link_url}
                onChange={(e) =>
                  setIdentityForm((p) => ({
                    ...p,
                    announcement_bar: {
                      ...p.announcement_bar,
                      link_url: e.target.value,
                    },
                  }))
                }
                placeholder="/explore?mode=pick_n_drop"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs text-[var(--ps-text)]"
              />
            </div>
            <div className="sm:col-span-3">
              <CustomSelectModal
                id="announcement-variant-select"
                label="Banner Style"
                value={identityForm.announcement_bar.variant}
                onChange={(val) =>
                  setIdentityForm((p) => ({
                    ...p,
                    announcement_bar: {
                      ...p.announcement_bar,
                      variant: val as AnnouncementVariant,
                    },
                  }))
                }
                options={[
                  { value: 'info', label: 'Info (Theme)' },
                  { value: 'success', label: 'Success (Green)' },
                  { value: 'warning', label: 'Warning (Amber)' },
                  { value: 'urgent', label: 'Urgent (Red)' },
                ]}
              />
            </div>
          </div>
        </div>
      </form>

      {/* 2. District Office & Support Contact */}
      <form
        onSubmit={handleSaveOffice}
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-[var(--ps-accent)]" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              District Office &amp; Support Contact
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUseCurrentGps}
              disabled={locatingGps}
              className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center gap-1.5"
            >
              {locatingGps ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LocateFixed className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              )}
              <span>Use Current GPS</span>
            </button>
            <button
              type="submit"
              disabled={savingSection !== null}
              data-testid="save-office-contact-btn"
              className="h-8 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60"
            >
              {savingSection === 'office' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save Office</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              District Office Address
            </label>
            <input
              type="text"
              value={officeForm.address}
              onChange={(e) =>
                setOfficeForm((p) => ({ ...p, address: e.target.value }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Office Latitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={officeForm.lat}
              onChange={(e) =>
                setOfficeForm((p) => ({
                  ...p,
                  lat: Number(e.target.value) || 0,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Office Longitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={officeForm.lng}
              onChange={(e) =>
                setOfficeForm((p) => ({
                  ...p,
                  lng: Number(e.target.value) || 0,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Support Phone
            </label>
            <input
              type="text"
              value={officeForm.phone}
              onChange={(e) =>
                setOfficeForm((p) => ({ ...p, phone: e.target.value }))
              }
              placeholder="+91 98620 XXXXX"
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              WhatsApp Number
            </label>
            <input
              type="text"
              value={officeForm.whatsapp}
              onChange={(e) =>
                setOfficeForm((p) => ({ ...p, whatsapp: e.target.value }))
              }
              placeholder="+91 98620 XXXXX"
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Support Email
            </label>
            <input
              type="email"
              value={officeForm.email}
              onChange={(e) =>
                setOfficeForm((p) => ({ ...p, email: e.target.value }))
              }
              placeholder="support@ddoodle.in"
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Operating Hours
            </label>
            <input
              type="text"
              value={officeForm.operating_hours}
              onChange={(e) =>
                setOfficeForm((p) => ({
                  ...p,
                  operating_hours: e.target.value,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              WhatsApp Enquiry Template (supports {'{{title}}'})
            </label>
            <input
              type="text"
              value={officeForm.whatsapp_enquiry_template}
              onChange={(e) =>
                setOfficeForm((p) => ({
                  ...p,
                  whatsapp_enquiry_template: e.target.value,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>
        </div>
      </form>

      {/* 3. Legal Policy Markdown CMS Editor */}
      <form
        onSubmit={handleSaveLegal}
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[var(--ps-accent)]" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              Legal CMS Editor (Markdown)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={legalPreviewHref}
              target="_blank"
              className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1"
            >
              <span>Live Preview</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
            <button
              type="submit"
              disabled={savingSection !== null}
              data-testid="save-legal-cms-btn"
              className="h-8 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60"
            >
              {savingSection === 'legal' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Publish Legal Policies</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { key: 'terms_md', label: 'Terms & Conditions' },
              { key: 'privacy_md', label: 'Privacy Policy' },
              { key: 'refund_policy_md', label: 'Refund & Cancellation' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveLegalTab(tab.key)}
              className={`h-8 px-3 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                activeLegalTab === tab.key
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <textarea
          rows={10}
          value={legalForm[activeLegalTab]}
          onChange={(e) =>
            setLegalForm((prev) => ({
              ...prev,
              [activeLegalTab]: e.target.value,
            }))
          }
          placeholder="# Policy Title&#10;&#10;Write Markdown using headings (#, ##), **bold**, bullet points (- item), and [links](/contact)..."
          className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
        />
      </form>
    </div>
  );
}
