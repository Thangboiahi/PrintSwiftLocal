'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Globe,
  Loader2,
  Phone,
  Plus,
  Save,
  Trash2,
  User,
} from 'lucide-react';
import {
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  OptimisticProfilePayload,
} from '@/components/navigation/Header';
import { AppProvider, useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { MediaUploader } from '@/components/shared/MediaUploader';
import { ProfileSkeleton } from '@/components/shared/Skeletons';

interface SocialLinkItem {
  id: string;
  platform: string;
  url: string;
}

const PRESET_PLATFORMS = [
  'WhatsApp',
  'Instagram',
  'Facebook',
  'X / Twitter',
  'LinkedIn',
  'YouTube',
  'Website',
];

function parseSocialLinksToItems(raw: unknown): SocialLinkItem[] {
  if (!raw || typeof raw !== 'object') {
    return [
      { id: 'soc-1', platform: 'WhatsApp', url: '' },
      { id: 'soc-2', platform: 'Instagram', url: '' },
      { id: 'soc-3', platform: 'Facebook', url: '' },
    ];
  }

  if (Array.isArray(raw)) {
    const mapped = raw
      .map((entry, idx) => {
        if (entry && typeof entry === 'object') {
          const obj = entry as { platform?: unknown; url?: unknown };
          return {
            id: `soc-${idx}-${Date.now()}`,
            platform: String(obj.platform || 'Website'),
            url: String(obj.url || ''),
          };
        }
        return null;
      })
      .filter((item): item is SocialLinkItem => item !== null);
    if (mapped.length > 0) return mapped;
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    return [
      { id: 'soc-1', platform: 'WhatsApp', url: '' },
      { id: 'soc-2', platform: 'Instagram', url: '' },
      { id: 'soc-3', platform: 'Facebook', url: '' },
    ];
  }

  return entries.map(([platform, url], idx) => ({
    id: `soc-${idx}-${Date.now()}`,
    platform,
    url: String(url ?? ''),
  }));
}

function serializeSocialLinksToJsonb(
  items: SocialLinkItem[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of items) {
    const key = item.platform.trim();
    const val = item.url.trim();
    if (key && val) {
      result[key] = val;
    }
  }
  return result;
}

function ProfileEditContent() {
  const { currentUser } = useAppStore();
  const { user: authUser } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [socialLinks, setSocialLinks] = useState<SocialLinkItem[]>([
    { id: 'soc-1', platform: 'WhatsApp', url: '' },
    { id: 'soc-2', platform: 'Instagram', url: '' },
    { id: 'soc-3', platform: 'Facebook', url: '' },
  ]);

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const fallbackName =
        (authUser?.user_metadata?.full_name as string | undefined) ||
        authUser?.email?.split('@')[0] ||
        currentUser.name ||
        '';
      const fallbackPhone = authUser?.phone || '+91 98620 00000';

      let cachedOptimistic: Partial<OptimisticProfilePayload> | null = null;
      if (typeof window !== 'undefined') {
        try {
          const rawCached = localStorage.getItem(OPTIMISTIC_PROFILE_STORAGE_KEY);
          if (rawCached) {
            cachedOptimistic = JSON.parse(
              rawCached
            ) as Partial<OptimisticProfilePayload>;
          }
        } catch {
          // ignore storage errors
        }
      }

      if (!isSupabaseConfigured()) {
        if (active) {
          setFullName(cachedOptimistic?.fullName || fallbackName);
          setPhone(cachedOptimistic?.phone || fallbackPhone);
          setAvatarUrl(cachedOptimistic?.avatarUrl || '');
          if (cachedOptimistic?.socialLinks) {
            setSocialLinks(
              parseSocialLinksToItems(cachedOptimistic.socialLinks)
            );
          }
          setIsLoadingProfile(false);
        }
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const targetUserId = sessionData?.session?.user?.id || authUser?.id;

      if (!targetUserId) {
        if (active) {
          setFullName(cachedOptimistic?.fullName || fallbackName);
          setPhone(cachedOptimistic?.phone || fallbackPhone);
          setAvatarUrl(cachedOptimistic?.avatarUrl || '');
          if (cachedOptimistic?.socialLinks) {
            setSocialLinks(
              parseSocialLinksToItems(cachedOptimistic.socialLinks)
            );
          }
          setIsLoadingProfile(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .maybeSingle();

      if (!active) return;

      if (!error && data) {
        const row = data as Record<string, unknown>;
        setFullName(
          String(
            row.full_name ||
              row.name ||
              cachedOptimistic?.fullName ||
              fallbackName
          )
        );
        setPhone(
          String(
            row.phone ||
              row.contact_phone ||
              cachedOptimistic?.phone ||
              fallbackPhone
          )
        );
        setAvatarUrl(
          String(row.avatar_url || cachedOptimistic?.avatarUrl || '')
        );
        setSocialLinks(
          parseSocialLinksToItems(
            row.social_links || cachedOptimistic?.socialLinks
          )
        );
      } else {
        setFullName(cachedOptimistic?.fullName || fallbackName);
        setPhone(cachedOptimistic?.phone || fallbackPhone);
        setAvatarUrl(cachedOptimistic?.avatarUrl || '');
        if (cachedOptimistic?.socialLinks) {
          setSocialLinks(parseSocialLinksToItems(cachedOptimistic.socialLinks));
        }
      }

      setIsLoadingProfile(false);
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [authUser, currentUser.name]);

  const handleAddSocialRow = () => {
    setSocialLinks((prev) => [
      ...prev,
      {
        id: `soc-${Date.now()}-${prev.length}`,
        platform: 'Website',
        url: '',
      },
    ]);
  };

  const handleRemoveSocialRow = (id: string) => {
    setSocialLinks((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateSocialRow = (
    id: string,
    field: 'platform' | 'url',
    value: string
  ) => {
    setSocialLinks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const cleanedName = fullName.trim();
    if (!cleanedName || cleanedName.length < 2) {
      setStatusNotice({
        type: 'error',
        text: 'Full name is required (at least 2 characters).',
      });
      return;
    }

    setIsSaving(true);
    setStatusNotice(null);

    const socialPayload = serializeSocialLinksToJsonb(socialLinks);
    const optimisticPayload: OptimisticProfilePayload = {
      fullName: cleanedName,
      phone: phone.trim(),
      avatarUrl: avatarUrl.trim(),
      socialLinks: socialPayload,
    };

    // Immediate Optimistic UI Update before network round-trip completes
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          OPTIMISTIC_PROFILE_STORAGE_KEY,
          JSON.stringify(optimisticPayload)
        );
      } catch {
        // ignore storage errors
      }
      window.dispatchEvent(
        new CustomEvent('printswift:profile-updated', {
          detail: optimisticPayload,
        })
      );
    }

    try {
      if (isSupabaseConfigured()) {
        const { data: sessionData } = await supabase.auth.getSession();
        const activeUser = sessionData?.session?.user ?? authUser;
        const targetId = activeUser?.id || currentUser.id;

        const { error } = await supabase.from('profiles').upsert(
          {
            id: targetId,
            email: activeUser?.email || currentUser.email,
            full_name: cleanedName,
            name: cleanedName,
            phone: phone.trim() || null,
            avatar_url: avatarUrl.trim() || null,
            social_links: socialPayload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

        if (error) {
          throw new Error(error.message);
        }
      }

      setStatusNotice({
        type: 'success',
        text: 'Your profile, avatar, and social links have been saved with immediate optimistic updates.',
      });
    } catch (err) {
      setStatusNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to save profile changes. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveProfileId = authUser?.id || currentUser.id || 'profile-avatar';

  return (
    <main
      data-testid="profile-edit-page"
      className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 pb-4">
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Profile</span>
          </Link>

          <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
            Comprehensive Profile Suite
          </span>
        </div>

        {isLoadingProfile ? (
          <ProfileSkeleton />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 shadow-xs"
          >
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                Edit Your Profile &amp; Social Links
              </h1>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                Update your public display name, contact phone, profile avatar, and connected social channels.
              </p>
            </div>

            {statusNotice && (
              <div
                role="status"
                aria-live="polite"
                data-testid="profile-edit-status-banner"
                className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
                  statusNotice.type === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                }`}
              >
                {statusNotice.type === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{statusNotice.text}</span>
              </div>
            )}

            {/* Avatar Upload Section */}
            <div className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)] flex items-center justify-center">
                  {avatarUrl.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl.trim()}
                      alt={fullName || 'User avatar'}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-8 w-8 text-[var(--ps-accent)]" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <h2 className="text-sm font-bold text-[var(--ps-text)]">
                    Profile Avatar
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Upload a square profile image to Supabase Storage or paste an external image URL below.
                  </p>
                  <input
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                    data-testid="profile-avatar-url-input"
                    className="mt-1.5 w-full min-h-[38px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3 py-1.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <MediaUploader
                mode="image"
                listingId={`avatar-${effectiveProfileId}`}
                label="Upload Avatar to Supabase Storage"
                helperText="JPEG, PNG, or WebP up to 5 MB"
                dataTestId="profile-avatar-uploader"
                onUploadSuccess={(publicUrl) => {
                  setAvatarUrl(publicUrl);
                  setStatusNotice({
                    type: 'success',
                    text: 'Avatar uploaded to Supabase Storage! Click Save Profile Changes to persist.',
                  });
                }}
              />
            </div>

            {/* Basic Identity Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="profile-edit-fullname"
                  className="block text-xs font-bold text-[var(--ps-text)]"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                  <input
                    id="profile-edit-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    data-testid="profile-edit-fullname-input"
                    className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-9 pr-3.5 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="profile-edit-phone"
                  className="block text-xs font-bold text-[var(--ps-text)]"
                >
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                  <input
                    id="profile-edit-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98620 00000"
                    data-testid="profile-edit-phone-input"
                    className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-9 pr-3.5 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Dynamic Social Links Array */}
            <div className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                    <Globe className="h-4 w-4 text-[var(--ps-accent)]" />
                    <span>Social Links (WhatsApp, Instagram, Facebook)</span>
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Add or update your social profiles stored in <code className="font-mono">profiles.social_links</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddSocialRow}
                  data-testid="add-social-link-btn"
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span>Add Link</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {socialLinks.map((item, idx) => (
                  <div
                    key={item.id}
                    data-testid={`social-link-row-${idx}`}
                    className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                  >
                    <select
                      value={
                        PRESET_PLATFORMS.includes(item.platform)
                          ? item.platform
                          : 'Website'
                      }
                      onChange={(e) =>
                        handleUpdateSocialRow(
                          item.id,
                          'platform',
                          e.target.value
                        )
                      }
                      aria-label={`Social platform ${idx + 1}`}
                      className="min-h-[40px] sm:w-40 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3 py-2 text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {PRESET_PLATFORMS.map((plat) => (
                        <option key={plat} value={plat}>
                          {plat}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      value={item.url}
                      onChange={(e) =>
                        handleUpdateSocialRow(item.id, 'url', e.target.value)
                      }
                      placeholder={`Enter ${item.platform} URL or handle...`}
                      aria-label={`${item.platform} URL or handle`}
                      className="min-h-[40px] flex-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />

                    <button
                      type="button"
                      onClick={() => handleRemoveSocialRow(item.id)}
                      aria-label={`Remove ${item.platform} link`}
                      className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Submit Bar */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 dark:border-gray-800 pt-4">
              <Link
                href="/profile"
                className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isSaving}
                data-testid="save-profile-edit-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 py-2.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 disabled:opacity-60"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Saving Changes…</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span>Save Profile Changes</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ProfileEditPage() {
  return (
    <AppProvider>
      <ProfileEditContent />
    </AppProvider>
  );
}
