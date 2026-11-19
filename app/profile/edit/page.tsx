'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle,
  CheckCircle2,
  Globe,
  Loader2,
  Phone,
  Plus,
  Save,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import {
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  OptimisticProfilePayload,
} from '@/components/navigation/Header';
import { AppProvider, useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { AvatarCropUploader } from '@/components/auth/AvatarCropUploader';
import { ProfileSkeleton } from '@/components/shared/Skeletons';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';

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
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [previewAvatar, setPreviewAvatar] = useState('');
  const [socialLinks, setSocialLinks] = useState<SocialLinkItem[]>([
    { id: 'soc-1', platform: 'WhatsApp', url: '' },
    { id: 'soc-2', platform: 'Instagram', url: '' },
    { id: 'soc-3', platform: 'Facebook', url: '' },
  ]);

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        setBio(String(row.bio || ''));
        const initialAvatar = String(
          row.avatar_url || cachedOptimistic?.avatarUrl || ''
        );
        setAvatarUrl(initialAvatar);
        setPreviewAvatar(initialAvatar);
        setSocialLinks(
          parseSocialLinksToItems(
            row.social_links || cachedOptimistic?.socialLinks
          )
        );
      } else {
        setFullName(cachedOptimistic?.fullName || fallbackName);
        setPhone(cachedOptimistic?.phone || fallbackPhone);
        setBio('');
        const fallbackAvatar = cachedOptimistic?.avatarUrl || '';
        setAvatarUrl(fallbackAvatar);
        setPreviewAvatar(fallbackAvatar);
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

  const profile = {
    avatar_url: previewAvatar || avatarUrl,
    full_name: fullName,
  };

  const handleAvatarCropComplete = (publicUrl: string) => {
    // Crucial Form State Change: Only update local React state variable.
    // DO NOT execute instant Supabase UPDATE on profiles table.
    setPreviewAvatar(publicUrl);
    setStatusNotice({
      type: 'success',
      text: 'Avatar cropped and staged as preview. Click "Save Profile Changes" below to apply.',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setSuccessMessage(null);
    setError(null);
    setStatusNotice(null);

    const cleanedName = fullName.trim();
    if (!cleanedName || cleanedName.length < 2) {
      setError('Full name is required (at least 2 characters).');
      return;
    }

    setIsSaving(true);

    const phoneNumber = phone;
    const finalAvatarUrl = (previewAvatar || avatarUrl).trim();
    const socialPayload = serializeSocialLinksToJsonb(socialLinks);
    const optimisticPayload: OptimisticProfilePayload = {
      fullName: cleanedName,
      phone: phoneNumber.trim(),
      avatarUrl: finalAvatarUrl,
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
        const user = sessionData?.session?.user ?? authUser;

        if (!user?.id) {
          throw new Error('You must be signed in to update your profile.');
        }

        const { error: dbError } = await supabase
          .from('profiles')
          .update({
            avatar_url: previewAvatar,
            full_name: fullName,
            phone: phoneNumber,
            bio: bio,
            social_links: socialLinks,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (dbError) {
          setError(dbError.message);
          throw new Error(dbError.message);
        }

        await supabase.auth.updateUser({
          data: {
            full_name: fullName,
            avatar_url: previewAvatar,
          },
        });

        // Claim the temporary media asset in media_assets if previewAvatar is present
        if (previewAvatar && user.id) {
          try {
            await supabase
              .from('media_assets')
              .update({ entity_id: user.id, is_temporary: false })
              .eq('public_url', previewAvatar);
          } catch (claimErr) {
            console.warn('Notice: non-fatal media_asset claim error:', claimErr);
          }
        }
      }

      setAvatarUrl(previewAvatar);
      setSuccessMessage('Profile updated and linked successfully!');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to save profile changes. Please try again.';
      setError(msg);
      setStatusNotice({
        type: 'error',
        text: msg,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveProfileId = authUser?.id || currentUser.id || 'profile-avatar';

  return (
    <div
      data-testid="profile-edit-page"
      className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-5 sm:px-6 lg:px-8"
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
            {successMessage && (
              <div className="mb-6 p-4 rounded-xl bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 flex items-center gap-2 font-medium">
                <CheckCircle className="w-5 h-5" /> {successMessage}
              </div>
            )}

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 flex items-center gap-2 font-medium text-xs">
                <AlertCircle className="w-5 h-5 shrink-0" /> {error}
              </div>
            )}

            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                Edit Your Profile &amp; Social Links
              </h1>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                Update your public display name, contact phone, profile avatar, and connected social channels.
              </p>
            </div>

            {statusNotice && !successMessage && (
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
            <div className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)] flex items-center justify-center">
                  {profile.avatar_url?.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url.trim()}
                      alt={profile.full_name || 'User avatar'}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full bg-blue-100 text-blue-600 text-2xl font-bold uppercase">
                      {profile.full_name?.charAt(0) || 'U'}
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <h2 className="text-sm font-bold text-[var(--ps-text)]">
                    Profile Avatar Preview
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Crop and stage a square profile photo below. Changes remain in preview until you click Save Profile Changes.
                  </p>
                </div>
              </div>

              {/* Strict Unified AvatarCropUploader Preview */}
              <AvatarCropUploader
                userId={authUser?.id || currentUser.id}
                currentAvatarUrl={profile.avatar_url}
                onUploadComplete={handleAvatarCropComplete}
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

            {/* Bio Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="profile-edit-bio"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Bio / About
              </label>
              <textarea
                id="profile-edit-bio"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell others a little about yourself or your printing needs..."
                data-testid="profile-edit-bio-input"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
                    <div className="sm:w-44 shrink-0">
                      <CustomSelectModal
                        value={
                          PRESET_PLATFORMS.includes(item.platform)
                            ? item.platform
                            : 'Website'
                        }
                        options={PRESET_PLATFORMS.map((plat) => ({
                          value: plat,
                          label: plat,
                        }))}
                        placeholder="Select platform"
                        testId={`social-platform-select-${idx}`}
                        onChange={(val) =>
                          handleUpdateSocialRow(item.id, 'platform', val)
                        }
                      />
                    </div>

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
    </div>
  );
}

export default function ProfileEditPage() {
  return (
    <AppProvider>
      <ProfileEditContent />
    </AppProvider>
  );
}
