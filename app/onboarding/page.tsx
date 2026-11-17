'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  Compass,
  FileText,
  Loader2,
  Phone,
  Sparkles,
  User,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { syncAuthenticatedProfileRole, useAuth } from '@/lib/auth';
import {
  PHONE_REGEX,
  USERNAME_REGEX,
  formatPhone,
  formatUsername,
  mapSupabaseAuthError,
  resolveInitialRole,
} from '@/lib/validators';
import { AvatarCropUploader } from '@/components/auth/AvatarCropUploader';
import { ProfileSkeleton } from '@/components/shared/Skeletons';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';

function OnboardingContent() {
  const router = useRouter();
  const { user, session } = useAuth();

  const [avatarUrl, setAvatarUrl] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function inspectProfile() {
      if (!isSupabaseConfigured()) {
        if (active) setIsCheckingProfile(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const activeUser = sessionData?.session?.user ?? user;

      if (!activeUser) {
        if (active) setIsCheckingProfile(false);
        return;
      }

      const metaName =
        (activeUser.user_metadata?.full_name as string | undefined) ||
        (activeUser.user_metadata?.name as string | undefined) ||
        activeUser.email?.split('@')[0] ||
        '';
      const metaPhone = activeUser.phone || '';

      const { data: profileRow } = await supabase
        .from('profiles')
        .select(
          'id, full_name, name, username, phone, bio, avatar_url, role, role_type'
        )
        .eq('id', activeUser.id)
        .maybeSingle();

      if (!active) return;

      const typedProfile = profileRow as {
        full_name?: string | null;
        name?: string | null;
        username?: string | null;
        phone?: string | null;
        bio?: string | null;
        avatar_url?: string | null;
        role?: string | null;
        role_type?: string | null;
      } | null;

      if (typedProfile?.full_name || typedProfile?.name || metaName) {
        setFullName(
          String(typedProfile?.full_name || typedProfile?.name || metaName)
        );
      }

      if (typedProfile?.username) {
        setUsername(formatUsername(typedProfile.username));
      } else if (activeUser.email?.includes('@')) {
        setUsername(formatUsername(activeUser.email.split('@')[0]));
      }

      if (typedProfile?.phone || metaPhone) {
        setPhone(String(typedProfile?.phone || metaPhone));
      }

      if (typedProfile?.bio) {
        setBio(typedProfile.bio);
      }

      if (typedProfile?.avatar_url) {
        setAvatarUrl(typedProfile.avatar_url);
      }

      if (
        (typedProfile?.role || typedProfile?.role_type) &&
        typedProfile?.full_name
      ) {
        router.replace('/');
        return;
      }

      setIsCheckingProfile(false);
    }

    void inspectProfile();

    return () => {
      active = false;
    };
  }, [user, router]);

  const validateFields = (): boolean => {
    const cleanedName = fullName.trim();
    const cleanedUsername = formatUsername(username);
    const cleanedPhone = phone.trim();
    let isValid = true;

    if (!cleanedName || cleanedName.length < 2) {
      setNameError('Please enter your full name (at least 2 characters).');
      isValid = false;
    } else {
      setNameError(null);
    }

    if (!cleanedUsername || !USERNAME_REGEX.test(cleanedUsername)) {
      setUsernameError(
        'Username must be 3–20 lowercase letters, numbers, or underscores.'
      );
      isValid = false;
    } else {
      setUsernameError(null);
    }

    if (!cleanedPhone || !PHONE_REGEX.test(cleanedPhone)) {
      setPhoneError(
        'Please enter a valid 10-digit Indian phone number (e.g., +91 9862011223).'
      );
      isValid = false;
    } else {
      setPhoneError(null);
    }

    return isValid;
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateFields()) {
      setErrorMessage(
        'Please review and fix the highlighted account information fields.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const cleanedName = fullName.trim();
      const cleanedUsername = formatUsername(username);
      const cleanedPhone = phone.trim();

      if (isSupabaseConfigured()) {
        const { data: sessionData } = await supabase.auth.getSession();
        const activeUser = sessionData?.session?.user ?? user;

        if (activeUser?.id) {
          // Role is strictly assigned via resolveInitialRole — no self-service promotion to owner
          const lockedRole = resolveInitialRole(activeUser.email);

          const { error: upsertError } = await supabase.from('profiles').upsert(
            {
              id: activeUser.id,
              email: activeUser.email ?? null,
              username: cleanedUsername,
              full_name: cleanedName,
              phone: cleanedPhone,
              bio: bio.trim() || null,
              avatar_url: avatarUrl.trim() || null,
              role: lockedRole,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          );

          if (upsertError) {
            throw upsertError;
          }

          await syncAuthenticatedProfileRole(
            activeUser,
            sessionData?.session ?? session ?? null,
            true
          );
        }
      }

      router.push('/');
    } catch (err) {
      setErrorMessage(mapSupabaseAuthError(err));
      setIsSubmitting(false);
    }
  };

  if (isCheckingProfile) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10">
        <div className="w-full max-w-md mx-auto p-6">
          <ProfileSkeleton />
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="onboarding-page"
      className="min-h-screen flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10"
    >
      <div className="w-full max-w-md mx-auto p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] shadow-sm space-y-6">
        <div className="space-y-2 border-b border-gray-200 dark:border-gray-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <span className="text-sm font-extrabold tracking-tight text-[var(--ps-text)] block">
                PrintSwift Local
              </span>
              <span className="text-[11px] text-[var(--ps-text-muted)]">
                Complete Your Profile Setup
              </span>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="onboarding-error-banner"
            className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form
          onSubmit={handleCompleteOnboarding}
          noValidate
          data-testid="onboarding-form"
          className="space-y-4"
        >
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Welcome to Lamka&apos;s Directory</span>
            </div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Finish your profile details
            </h1>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)] leading-relaxed">
              New accounts start as verified community visitors. Administrator and business owner permissions are governed by platform administrators.
            </p>
          </div>

          <AvatarCropUploader
            userId={user?.id || 'onboarding'}
            currentAvatarUrl={avatarUrl}
            onUploadComplete={(url) => setAvatarUrl(url)}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-full-name"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Full Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="onboarding-full-name"
                type="text"
                required
                aria-invalid={Boolean(nameError)}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g., Thangboi Haokip"
                data-testid="onboarding-name-input"
                className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 py-2.5 text-sm text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {nameError && (
              <p
                role="alert"
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
              >
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-username"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Username <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <AtSign className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="onboarding-username"
                type="text"
                required
                value={username}
                onChange={(e) => {
                  setUsername(formatUsername(e.target.value));
                  if (usernameError) setUsernameError(null);
                }}
                placeholder="username"
                data-testid="onboarding-username-input"
                className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 py-2.5 text-sm font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {usernameError && (
              <p
                role="alert"
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
              >
                {usernameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-phone"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Contact Phone Number <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Phone className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="onboarding-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  if (phoneError) setPhoneError(null);
                }}
                placeholder="+91 9862011223"
                data-testid="onboarding-phone-input"
                className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 py-2.5 text-sm text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {phoneError && (
              <p
                role="alert"
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
              >
                {phoneError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-bio"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Short Bio (Optional)
            </label>
            <div className="relative">
              <FileText className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-3 pointer-events-none" />
              <textarea
                id="onboarding-bio"
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell the community about yourself…"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="onboarding-submit-btn"
            className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-sm transition hover:opacity-95 disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving Profile…</span>
              </>
            ) : (
              <>
                <span>Complete Setup</span>
                <CheckCircle2 className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <ProtectedRoute>
      <OnboardingContent />
    </ProtectedRoute>
  );
}
