'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Globe,
  Loader2,
  MapPin,
  Save,
  Trash2,
  User,
} from 'lucide-react';
import {
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  type OptimisticProfilePayload,
} from '@/components/navigation/Header';
import { ProfileSkeleton } from '@/components/profile/ProfileSkeleton';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  PhoneInput,
  isValidCountryPhone,
  normalizePhoneToE164,
} from '@/components/ui/PhoneInput';
import { compressAvatarToWebp } from '@/lib/media/pod-compressor';
import { AppProvider, useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { USERNAME_REGEX, formatUsername } from '@/lib/validators';

const CHURACHANDPUR_LOCALITIES = [
  'Churachandpur Central (Lamka)',
  'New Lamka',
  'Tuibong',
  'Rengkai',
  'Hill Town',
  'Zenhang Lamka',
  'Hiangtam Lamka',
  'Pearsonmun',
  'IB Road / Tipaimukh Road',
  'Lingsiphai',
  'Mualveng / Bungmual',
  'Other Area in Churachandpur',
];

interface SocialLinksForm {
  WhatsApp: string;
  Instagram: string;
  Facebook: string;
  Website: string;
}

const EMPTY_SOCIALS: SocialLinksForm = {
  WhatsApp: '',
  Instagram: '',
  Facebook: '',
  Website: '',
};

function parseSocialsFromDb(raw: unknown): SocialLinksForm {
  const next: SocialLinksForm = { ...EMPTY_SOCIALS };
  if (!raw || typeof raw !== 'object') return next;

  const assignIfKnown = (platform: string, val: string) => {
    const key = platform.trim().toLowerCase();
    const cleaned = val.trim();
    if (!cleaned) return;
    if (key.includes('whatsapp')) next.WhatsApp = cleaned;
    else if (key.includes('instagram')) next.Instagram = cleaned;
    else if (key.includes('facebook')) next.Facebook = cleaned;
    else if (key.includes('website') || key.includes('web')) {
      next.Website = cleaned;
    }
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === 'object') {
        const obj = entry as { platform?: unknown; url?: unknown };
        assignIfKnown(String(obj.platform || ''), String(obj.url || ''));
      }
    }
    return next;
  }

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    assignIfKnown(k, String(v ?? ''));
  }
  return next;
}

function validateHttpsSocialUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith('https://')) {
    return 'Must start with https:// (secure link required).';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) {
      return 'Enter a valid https:// URL.';
    }
    return null;
  } catch {
    return 'Enter a valid https:// URL.';
  }
}

function ProfileEditContent() {
  const router = useRouter();
  const { currentUser } = useAppStore();
  const { user: authUser } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredLocality, setPreferredLocality] = useState(
    CHURACHANDPUR_LOCALITIES[0]
  );
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [socials, setSocials] = useState<SocialLinksForm>(EMPTY_SOCIALS);

  const [initialSnapshot, setInitialSnapshot] = useState<string>('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarInfo, setAvatarInfo] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const markTouched = (key: string) => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const meta = (authUser?.user_metadata || {}) as Record<string, unknown>;
      const fallbackName = String(
        meta.full_name ||
          meta.name ||
          authUser?.email?.split('@')[0] ||
          currentUser.name ||
          ''
      );
      const fallbackAvatar = String(meta.avatar_url || meta.picture || '');
      const fallbackPhone = authUser?.phone
        ? normalizePhoneToE164(authUser.phone)
        : '';

      const applyValues = (vals: {
        fullName: string;
        username: string;
        phone: string;
        preferredLocality: string;
        bio: string;
        avatarUrl: string;
        socials: SocialLinksForm;
      }) => {
        setFullName(vals.fullName);
        setUsername(vals.username);
        setPhone(vals.phone);
        setPreferredLocality(vals.preferredLocality);
        setBio(vals.bio);
        setAvatarUrl(vals.avatarUrl);
        setSocials(vals.socials);
        setInitialSnapshot(JSON.stringify(vals));
      };

      if (!isSupabaseConfigured()) {
        if (active) {
          applyValues({
            fullName: fallbackName,
            username: formatUsername(fallbackName),
            phone: fallbackPhone,
            preferredLocality: CHURACHANDPUR_LOCALITIES[0],
            bio: '',
            avatarUrl: fallbackAvatar,
            socials: EMPTY_SOCIALS,
          });
          setIsLoadingProfile(false);
        }
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const targetUserId = sessionData?.session?.user?.id || authUser?.id;

      if (!targetUserId) {
        if (active) {
          applyValues({
            fullName: fallbackName,
            username: formatUsername(fallbackName),
            phone: fallbackPhone,
            preferredLocality: CHURACHANDPUR_LOCALITIES[0],
            bio: '',
            avatarUrl: fallbackAvatar,
            socials: EMPTY_SOCIALS,
          });
          setIsLoadingProfile(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'full_name, username, phone, bio, avatar_url, preferred_locality, social_links'
        )
        .eq('id', targetUserId)
        .maybeSingle();

      if (!active) return;

      if (!error && data) {
        const row = data as Record<string, unknown>;
        applyValues({
          fullName: String(row.full_name || fallbackName),
          username: String(row.username || ''),
          phone: row.phone
            ? normalizePhoneToE164(String(row.phone))
            : fallbackPhone,
          preferredLocality:
            typeof row.preferred_locality === 'string' &&
            row.preferred_locality.trim()
              ? row.preferred_locality.trim()
              : CHURACHANDPUR_LOCALITIES[0],
          bio: String(row.bio || ''),
          avatarUrl: String(row.avatar_url || fallbackAvatar),
          socials: parseSocialsFromDb(row.social_links),
        });
      } else {
        applyValues({
          fullName: fallbackName,
          username: '',
          phone: fallbackPhone,
          preferredLocality: CHURACHANDPUR_LOCALITIES[0],
          bio: '',
          avatarUrl: fallbackAvatar,
          socials: EMPTY_SOCIALS,
        });
      }

      setIsLoadingProfile(false);
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, [authUser, currentUser.name]);

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        fullName,
        username,
        phone,
        preferredLocality,
        bio,
        avatarUrl,
        socials,
      }),
    [fullName, username, phone, preferredLocality, bio, avatarUrl, socials]
  );

  const isDirty = Boolean(
    !isLoadingProfile &&
      initialSnapshot !== '' &&
      currentSnapshot !== initialSnapshot
  );

  // Browser tab close / reload dirty-state guard
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const fieldErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2) {
      errs.fullName = 'Full name is required (at least 2 characters).';
    }
    const cleanUser = formatUsername(username);
    if (cleanUser && !USERNAME_REGEX.test(cleanUser)) {
      errs.username =
        'Use 3–24 lowercase letters, numbers, or underscores only.';
    }
    if (phone.trim() && !isValidCountryPhone(phone)) {
      errs.phone = 'Enter a valid 10-digit Indian mobile number (+91).';
    }

    for (const key of ['WhatsApp', 'Instagram', 'Facebook', 'Website'] as const) {
      const err = validateHttpsSocialUrl(socials[key]);
      if (err) errs[`social_${key}`] = err;
    }

    return errs;
  }, [fullName, username, phone, socials]);

  const isFormValid = Object.keys(fieldErrors).length === 0;
  const showError = (key: string): string | null =>
    touched[key] || submitAttempted ? fieldErrors[key] || null : null;

  const handleAvatarFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setAvatarInfo(null);
    setIsUploadingAvatar(true);

    try {
      const compressed = await compressAvatarToWebp(file);

      if (!isSupabaseConfigured()) {
        const previewDataUrl = URL.createObjectURL(compressed.blob);
        setAvatarUrl(previewDataUrl);
        setAvatarInfo(
          `Compressed to ${compressed.compressedKb} KB WebP (${compressed.width}×${compressed.height}px). Click Save Changes to apply.`
        );
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id || authUser?.id;
      if (!userId) {
        throw new Error('Please sign in to upload a profile photo.');
      }

      const objectPath = `${userId}/${compressed.fileName}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(objectPath, compressed.blob, {
          contentType: compressed.mimeType,
          cacheControl: '31536000',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: publicData } = supabase.storage
        .from('avatars')
        .getPublicUrl(objectPath);

      if (!publicData?.publicUrl) {
        throw new Error('Uploaded photo could not generate a public URL.');
      }

      setAvatarUrl(publicData.publicUrl);
      setAvatarInfo(
        `Optimized to ${compressed.compressedKb} KB WebP (${compressed.width}×${compressed.height}px). Click Save Profile Changes to apply.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not upload avatar photo. Please try again.'
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleNavigateBack = async () => {
    if (!isDirty) {
      router.push('/profile');
      return;
    }

    const discard = await confirm({
      title: 'Discard unsaved profile changes?',
      description:
        'You have unsaved edits on your profile. Leaving now will discard them.',
      confirmLabel: 'Discard Changes',
      cancelLabel: 'Keep Editing',
      variant: 'danger',
    });
    if (discard) {
      router.push('/profile');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isFormValid) {
      setErrorMessage('Please fix the highlighted fields before saving.');
      return;
    }

    const accepted = await confirm({
      title: 'Save profile changes?',
      description:
        'Your updated name, contact number, locality, avatar, and social links will be saved to your DD oodle account.',
      confirmLabel: 'Save Changes',
      cancelLabel: 'Review Again',
      variant: 'info',
    });
    if (!accepted) return;

    setIsSaving(true);

    const cleanName = fullName.trim();
    const cleanUsername = formatUsername(username);
    const normalizedPhone = phone.trim()
      ? normalizePhoneToE164(phone) || phone.trim()
      : '';
    const socialPayload: Record<string, string> = {};
    for (const key of ['WhatsApp', 'Instagram', 'Facebook', 'Website'] as const) {
      const val = socials[key].trim();
      if (val) socialPayload[key] = val;
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
            full_name: cleanName,
            username: cleanUsername || null,
            phone: normalizedPhone || null,
            preferred_locality: preferredLocality || null,
            bio: bio.trim() || null,
            avatar_url: avatarUrl.trim() || null,
            social_links: socialPayload,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (dbError) {
          throw new Error(
            dbError.message.includes('username')
              ? 'That @username is already taken. Please choose another.'
              : dbError.message
          );
        }

        await supabase.auth.updateUser({
          data: {
            full_name: cleanName,
            avatar_url: avatarUrl.trim() || null,
            phone: normalizedPhone || null,
          },
        });
      }

      const optimisticPayload: OptimisticProfilePayload = {
        fullName: cleanName,
        phone: normalizedPhone,
        avatarUrl: avatarUrl.trim(),
        socialLinks: socialPayload,
      };
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

      setInitialSnapshot(currentSnapshot);
      setSuccessMessage('Profile saved successfully.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to save profile changes right now.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingProfile) {
    return <ProfileSkeleton />;
  }

  return (
    <main className="w-full max-w-2xl mx-auto px-4 sm:px-6 pt-5 pb-20 lg:pb-12 bg-[var(--ps-bg)] text-[var(--ps-text)] space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void handleNavigateBack()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Profile</span>
        </button>
        {isDirty && (
          <span className="rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
            Unsaved changes
          </span>
        )}
      </div>

      <form
        onSubmit={handleSaveProfile}
        noValidate
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 space-y-5 shadow-xs"
      >
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
            Edit Profile
          </h1>
          <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
            Update your photo, Churachandpur locality, +91 mobile number, and
            verified https:// social links.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* WebP Avatar Upload Section (<= 150 KB, max 512px square) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
          <div className="relative h-20 w-20 shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={fullName || 'Avatar preview'}
                referrerPolicy="no-referrer"
                className="h-20 w-20 rounded-full object-cover border-2 border-[var(--ps-accent)]/40"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]">
                <User className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarFileSelected}
                className="hidden"
              />
              <button
                type="button"
                disabled={isUploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                data-testid="profile-avatar-upload-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-60 cursor-pointer"
              >
                {isUploadingAvatar ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Optimizing WebP…</span>
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4" />
                    <span>Upload Photo (Auto WebP)</span>
                  </>
                )}
              </button>

              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setAvatarUrl('');
                    setAvatarInfo('Photo removed. Click Save Changes to confirm.');
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              {avatarInfo ||
                'Square-cropped and compressed automatically to <= 150 KB WebP (512×512px max).'}
            </p>
          </div>
        </div>

        {/* Identity Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1">
            <label
              htmlFor="profile-edit-fullname"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="profile-edit-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onBlur={() => markTouched('fullName')}
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
            />
            {showError('fullName') && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {showError('fullName')}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="profile-edit-username"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Username Handle
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--ps-text-muted)]">
                @
              </span>
              <input
                id="profile-edit-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(formatUsername(e.target.value))}
                onBlur={() => markTouched('username')}
                placeholder="lamka_member"
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-3.5 text-sm font-mono text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
              />
            </div>
            {showError('username') && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {showError('username')}
              </p>
            )}
          </div>
        </div>

        {/* Contact +91 & Preferred Locality */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <PhoneInput
              label="Mobile Number (+91)"
              value={phone}
              onChange={(val) => {
                setPhone(val);
                markTouched('phone');
              }}
              error={showError('phone') || undefined}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="profile-edit-locality"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Preferred Locality
            </label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-accent)]" />
              <select
                id="profile-edit-locality"
                value={preferredLocality}
                onChange={(e) => setPreferredLocality(e.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
              >
                {CHURACHANDPUR_LOCALITIES.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Short Bio */}
        <div className="space-y-1">
          <label
            htmlFor="profile-edit-bio"
            className="block text-xs font-bold text-[var(--ps-text)]"
          >
            Short Bio (Optional)
          </label>
          <textarea
            id="profile-edit-bio"
            rows={3}
            maxLength={280}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Share a short note about yourself or your Churachandpur services…"
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
          />
        </div>

        {/* Validated HTTPS Social Links */}
        <div className="space-y-3 pt-2 border-t border-[var(--ps-border)]">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Social &amp; Contact Links (HTTPS Only)
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                {
                  key: 'WhatsApp',
                  placeholder: 'https://wa.me/919862000000',
                },
                {
                  key: 'Instagram',
                  placeholder: 'https://instagram.com/yourhandle',
                },
                {
                  key: 'Facebook',
                  placeholder: 'https://facebook.com/yourpage',
                },
                {
                  key: 'Website',
                  placeholder: 'https://yourbusiness.in',
                },
              ] as const
            ).map(({ key, placeholder }) => {
              const errKey = `social_${key}`;
              return (
                <div key={key} className="space-y-1">
                  <label
                    htmlFor={`profile-social-${key}`}
                    className="block text-xs font-bold text-[var(--ps-text-muted)]"
                  >
                    {key}
                  </label>
                  <input
                    id={`profile-social-${key}`}
                    type="url"
                    value={socials[key]}
                    onChange={(e) =>
                      setSocials((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    onBlur={() => markTouched(errKey)}
                    placeholder={placeholder}
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                  />
                  {showError(errKey) && (
                    <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      {showError(errKey)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Submit / Cancel Footer */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2 border-t border-[var(--ps-border)]">
          <button
            type="button"
            onClick={() => void handleNavigateBack()}
            disabled={isSaving}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || isUploadingAvatar}
            data-testid="profile-edit-save-btn"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-60 cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving…</span>
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

      {confirmDialog}
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
