'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  LocateFixed,
  Megaphone,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { uploadImage } from '@/lib/supabase/storage';
import {
  normalizeAppIdentity,
  normalizeLegalPages,
  normalizeOfficeAndContact,
  type AnnouncementVariant,
  type AppIdentityConfig,
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
        logo_light_url:
          variant === 'light' ? uploaded.publicUrl : prev.logo_light_url,
        logo_dark_url:
          variant === 'dark' ? uploaded.publicUrl : prev.logo_dark_url,
      }));
      setAppStatus('success', 'Logo uploaded (click Save Identity)');
      onNotify?.({
        type: 'info',
        text: `Uploaded ${variant} logo. Click "Save Identity & Banner" to publish.`,
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

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
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
            className="h-8 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60"
          >
            {savingSection === 'identity' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save Identity &amp; Banner</span>
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

        {/* Light & Dark Logo Uploaders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(['light', 'dark'] as const).map((variant) => {
            const url =
              variant === 'light'
                ? identityForm.logo_light_url
                : identityForm.logo_dark_url;
            return (
              <div
                key={variant}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl border border-[var(--ps-border)] flex items-center justify-center overflow-hidden shrink-0 ${
                      variant === 'dark' ? 'bg-slate-900' : 'bg-white'
                    }`}
                  >
                    {url ? (
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
                      {url ? 'Custom logo active' : 'Using default MapPin badge'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center gap-1 cursor-pointer">
                    {uploadingLogo === variant ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3 h-3" />
                    )}
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
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
                      className="h-8 w-8 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

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
              placeholder="support@printswiftlocal.in"
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
