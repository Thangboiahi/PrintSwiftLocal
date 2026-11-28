'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle2,
  Compass,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Megaphone,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Store,
  Truck,
  User,
} from 'lucide-react';
import { PartnerOnboardingClient } from '@/components/onboarding/PartnerOnboardingClient';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import {
  PhoneInput,
  isValidCountryPhone,
  normalizePhoneToE164,
} from '@/components/ui/PhoneInput';
import { useAuth } from '@/lib/auth';
import { sanitizeRelativeNextPath } from '@/lib/env';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  PASSWORD_REGEX,
  USERNAME_REGEX,
  formatUsername,
  getPasswordStrength,
} from '@/lib/validators';

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

type RoleIntentId = 'explore' | 'owner' | 'driver' | 'advertiser';

const ROLE_INTENT_CARDS: Array<{
  id: RoleIntentId;
  title: string;
  subtitle: string;
  route: string;
  icon: typeof Compass;
}> = [
  {
    id: 'explore',
    title: 'Explore & Shop',
    subtitle:
      'Discover shops, hospitals, civic helplines, Pick N Drop & book vehicles.',
    route: '/explore',
    icon: Compass,
  },
  {
    id: 'owner',
    title: 'List a Business / Property',
    subtitle:
      'Manage shops, restaurants, rooms, print orders, or real estate listings.',
    route: '/onboarding?track=business',
    icon: Store,
  },
  {
    id: 'driver',
    title: 'Drive & Deliver',
    subtitle:
      'Accept Pick N Drop parcel/passenger trips or list scheduled vehicles.',
    route: '/onboarding?track=driver',
    icon: Truck,
  },
  {
    id: 'advertiser',
    title: 'Publish Bulletins',
    subtitle:
      'Post district announcements, job openings, events & YouTube notices.',
    route: '/onboarding?track=advertiser',
    icon: Megaphone,
  },
];

function GuidedOnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, fullName: authFullName, avatarUrl: authAvatarUrl, isLoading, realRole } =
    useAuth();
  const { activeHub, hubLocalities } = useAppConfig();
  const activeHubId = activeHub?.id;

  const localityOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (hubLocalities || [])
          .filter((l) => !activeHubId || !l.hub_id || l.hub_id === activeHubId)
          .map((l) => String(l.display_name || '').trim())
          .filter(Boolean)
      )
    );
    const list = names.length > 0 ? names : CHURACHANDPUR_LOCALITIES;
    return list.map((loc) => ({ value: loc, label: loc }));
  }, [hubLocalities, activeHubId]);

  const rawTrack = (searchParams.get('track') || searchParams.get('role') || '')
    .trim()
    .toLowerCase();
  const trackParam =
    rawTrack === 'owner'
      ? 'business'
      : rawTrack === 'business' || rawTrack === 'driver' || rawTrack === 'advertiser'
        ? rawTrack
        : '';
  const oauthParam = (searchParams.get('oauth') || '').trim().toLowerCase();
  const safeNext = sanitizeRelativeNextPath(searchParams.get('next'), '/explore');

  // Preserve Partner KYC deep-links (?track=business|driver|advertiser or ?role=owner|driver|advertiser)
  const [showPartnerKyc, setShowPartnerKyc] = useState<boolean>(
    Boolean(trackParam)
  );

  useEffect(() => {
    if (trackParam) {
      setShowPartnerKyc(true);
    }
  }, [trackParam]);

  // 2-Step Guided Onboarding state
  const [step, setStep] = useState<1 | 2>(1);
  const [isHydrating, setIsHydrating] = useState(true);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredLocality, setPreferredLocality] = useState(
    CHURACHANDPUR_LOCALITIES[0]
  );
  const [avatarPreview, setAvatarPreview] = useState('');
  const [selectedIntent, setSelectedIntent] = useState<RoleIntentId>('explore');

  // Google OAuth password setup state (Step 1)
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [hasCompletedPasswordSetup, setHasCompletedPasswordSetup] =
    useState(false);
  const [isStep1Submitting, setIsStep1Submitting] = useState(false);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [step1SubmitAttempted, setStep1SubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Detect whether this user signed up via Google OAuth and still needs to set an account password
  const requiresGooglePasswordSetup = useMemo(() => {
    if (hasCompletedPasswordSetup) return false;
    if (!user) return oauthParam === 'google';
    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    if (meta.password_set === true) return false;
    const identities = Array.isArray(user.identities) ? user.identities : [];
    const hasEmailIdentity = identities.some(
      (id) => String(id?.provider || '').toLowerCase() === 'email'
    );
    if (hasEmailIdentity) return false;
    const hasGoogleIdentity =
      identities.some(
        (id) => String(id?.provider || '').toLowerCase() === 'google'
      ) ||
      String(
        (user.app_metadata as Record<string, unknown> | undefined)?.provider ||
          ''
      ).toLowerCase() === 'google';
    return oauthParam === 'google' || hasGoogleIdentity;
  }, [user, oauthParam, hasCompletedPasswordSetup]);

  const isGoogleSyncedAccount = useMemo(() => {
    if (oauthParam === 'google') return true;
    if (!user) return false;
    const identities = Array.isArray(user.identities) ? user.identities : [];
    return (
      identities.some(
        (id) => String(id?.provider || '').toLowerCase() === 'google'
      ) ||
      String(
        (user.app_metadata as Record<string, unknown> | undefined)?.provider ||
          ''
      ).toLowerCase() === 'google'
    );
  }, [user, oauthParam]);

  const passwordStrength = useMemo(
    () => getPasswordStrength(password),
    [password]
  );

  // Hydrate existing profile / Google metadata once user is loaded
  useEffect(() => {
    if (showPartnerKyc) return;
    if (isLoading) return;
    if (!user) {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) setIsHydrating(false);
      });
      return () => {
        cancelled = true;
      };
    }

    let active = true;
    const hydrate = async () => {
      const meta = (user.user_metadata || {}) as Record<string, unknown>;
      const googleName = String(
        meta.full_name || meta.name || authFullName || ''
      ).trim();
      const googleAvatar = String(
        meta.avatar_url || meta.picture || authAvatarUrl || ''
      ).trim();
      const emailHandle = formatUsername(
        (user.email || '').split('@')[0] || ''
      );

      if (isSupabaseConfigured()) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select(
              'full_name, username, phone, avatar_url, preferred_locality, onboarding_completed_at'
            )
            .eq('id', user.id)
            .maybeSingle();

          if (!active) return;
          if (data) {
            const row = data as Record<string, unknown>;
            setFullName(String(row.full_name || googleName || ''));
            setUsername(String(row.username || emailHandle || ''));
            setPhone(
              row.phone ? normalizePhoneToE164(String(row.phone)) : ''
            );
            setAvatarPreview(String(row.avatar_url || googleAvatar || ''));
            if (
              typeof row.preferred_locality === 'string' &&
              row.preferred_locality.trim()
            ) {
              setPreferredLocality(row.preferred_locality.trim());
            }
            setIsHydrating(false);
            return;
          }
        } catch {
          // Fall through to metadata defaults
        }
      }

      if (!active) return;
      setFullName(googleName);
      setUsername(emailHandle);
      setAvatarPreview(googleAvatar);
      setIsHydrating(false);
    };

    void hydrate();
    return () => {
      active = false;
    };
  }, [user, authFullName, authAvatarUrl, isLoading, showPartnerKyc]);

  const step1Errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2) {
      errs.fullName = 'Please enter your full name (at least 2 characters).';
    }
    const cleanUsername = formatUsername(username);
    if (!cleanUsername) {
      errs.username = 'Choose a @username handle.';
    } else if (!USERNAME_REGEX.test(cleanUsername)) {
      errs.username =
        'Use 3–20 lowercase letters, numbers, or underscores only.';
    }
    if (!phone.trim()) {
      errs.phone = 'Enter your +91 mobile number.';
    } else if (!isValidCountryPhone(phone)) {
      errs.phone = 'Enter a valid 10-digit Indian mobile number (+91).';
    }
    if (!preferredLocality.trim()) {
      errs.preferredLocality = 'Select your preferred Churachandpur locality.';
    }
    if (requiresGooglePasswordSetup) {
      if (!password) {
        errs.password =
          'Set an account password so you can also sign in with email & password.';
      } else if (!PASSWORD_REGEX.test(password) || !passwordStrength.isValid) {
        errs.password =
          'Password must be 8+ chars with uppercase, lowercase, number, and symbol.';
      }
      if (!confirmPassword) {
        errs.confirmPassword = 'Confirm your account password.';
      } else if (confirmPassword !== password) {
        errs.confirmPassword = 'Passwords do not match.';
      }
    }
    return errs;
  }, [
    fullName,
    username,
    phone,
    preferredLocality,
    requiresGooglePasswordSetup,
    password,
    passwordStrength.isValid,
    confirmPassword,
  ]);

  const step1Valid = Object.keys(step1Errors).length === 0;

  if (showPartnerKyc) {
    return (
      <div>
        {!trackParam && (
          <div className="mx-auto max-w-4xl px-4 pt-4">
            <button
              type="button"
              onClick={() => setShowPartnerKyc(false)}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-bold text-[var(--ps-accent)] hover:underline cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to 2-Step Account Setup</span>
            </button>
          </div>
        )}
        <PartnerOnboardingClient />
      </div>
    );
  }

  if (isLoading || isHydrating) {
    return (
      <main className="min-h-screen bg-[var(--ps-bg)] px-4 py-10 text-[var(--ps-text)]">
        <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6">
          <div className="dd-shimmer h-5 w-36 rounded-lg" />
          <div className="dd-shimmer h-8 w-3/4 rounded-xl" />
          <div className="dd-shimmer h-12 w-full rounded-xl" />
          <div className="dd-shimmer h-12 w-full rounded-xl" />
          <div className="dd-shimmer h-12 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-[var(--ps-text)]">
        <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-extrabold">Sign in to complete setup</h1>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Continue with Google or your email to personalize your Churachandpur
            DD oodle profile.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <Link
              href="/login?next=/onboarding"
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)]"
            >
              Sign In / Sign Up
            </Link>
            <Link
              href="/explore"
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-bold text-[var(--ps-text)]"
            >
              Browse as Guest
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const handleContinueToStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep1SubmitAttempted(true);
    setErrorMsg(null);
    if (!step1Valid) return;

    if (requiresGooglePasswordSetup && isSupabaseConfigured()) {
      setIsStep1Submitting(true);
      try {
        const { error: pwdErr } = await supabase.auth.updateUser({
          password,
          data: {
            password_set: true,
            full_name: fullName.trim(),
            avatar_url: avatarPreview || null,
          },
        });
        if (pwdErr) {
          throw new Error(pwdErr.message || 'Could not save account password.');
        }
        setHasCompletedPasswordSetup(true);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Could not set account password. Please try again.'
        );
        setIsStep1Submitting(false);
        return;
      }
      setIsStep1Submitting(false);
    }

    setStep(2);
  };

  const handleCompleteOnboarding = async () => {
    setErrorMsg(null);
    setIsSaving(true);

    const cleanName = fullName.trim();
    const cleanUsername = formatUsername(username);
    const normalizedPhone = normalizePhoneToE164(phone) || phone.trim();
    const intentCard =
      ROLE_INTENT_CARDS.find((c) => c.id === selectedIntent) ||
      ROLE_INTENT_CARDS[0];

    try {
      if (isSupabaseConfigured()) {
        const profilePayload: Record<string, unknown> = {
          full_name: cleanName,
          username: cleanUsername || null,
          phone: normalizedPhone,
          preferred_locality: preferredLocality,
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (avatarPreview) {
          profilePayload.avatar_url = avatarPreview;
        }

        const { error } = await supabase
          .from('profiles')
          .update(profilePayload)
          .eq('id', user.id);

        if (error) {
          throw new Error(
            error.message.includes('username')
              ? 'That @username is already taken. Go back to Step 1 to pick another handle.'
              : error.message
          );
        }

        await supabase.auth.updateUser({
          data: {
            full_name: cleanName,
            phone: normalizedPhone,
            preferred_locality: preferredLocality,
            ...(avatarPreview ? { avatar_url: avatarPreview } : {}),
            ...(hasCompletedPasswordSetup ? { password_set: true } : {}),
          },
        });
      }

      const targetRoute =
        selectedIntent === 'explore'
          ? safeNext !== '/'
            ? safeNext
            : intentCard.route
          : selectedIntent === 'owner' && realRole === 'owner'
            ? '/workspace?hat=owner'
            : selectedIntent === 'driver' && realRole === 'driver'
              ? '/workspace?hat=driver'
              : selectedIntent === 'advertiser' &&
                  (realRole === 'owner' || realRole === 'admin' || realRole === 'super_admin')
                ? '/workspace?hat=advertiser'
                : intentCard.route;
      if (targetRoute.startsWith('/onboarding?')) {
        setShowPartnerKyc(true);
      }
      router.push(targetRoute);
      router.refresh();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not save your onboarding setup. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkipOnboarding = () => {
    if (typeof window !== 'undefined' && user?.id) {
      try {
        window.localStorage.setItem(`dd_onboarding_skipped_${user.id}`, '1');
      } catch {
        // ignore storage errors
      }
    }
    router.push(safeNext || '/explore');
  };

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] px-4 py-8 sm:py-12 text-[var(--ps-text)]">
      <div className="mx-auto max-w-xl space-y-5">
        {/* Progress & Skip Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                Step {step} of 2 · {activeHub?.name || 'Churachandpur'} Setup
              </span>
            </span>
            <h1 className="mt-0.5 text-xl sm:text-2xl font-extrabold tracking-tight">
              {step === 1
                ? 'Your Identity, Contact & Area'
                : 'How Will You Use DD oodle?'}
            </h1>
          </div>

          {!requiresGooglePasswordSetup && (
            <button
              type="button"
              onClick={handleSkipOnboarding}
              data-testid="onboarding-skip-btn"
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <span>Skip for now</span>
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 2-Segment Progress Bar */}
        <div className="grid grid-cols-2 gap-2">
          <div className="h-1.5 rounded-full bg-[var(--ps-accent)]" />
          <div
            className={`h-1.5 rounded-full transition-colors ${
              step === 2 ? 'bg-[var(--ps-accent)]' : 'bg-[var(--ps-border)]'
            }`}
          />
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* STEP 1: Identity, Contact & Preferred Locality */}
        {step === 1 && (
          <form
            onSubmit={(e) => void handleContinueToStep2(e)}
            noValidate
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 space-y-4 shadow-xs"
          >
            {/* Google Avatar & Synced Email Preview */}
            <div className="flex items-center gap-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview}
                  alt={fullName || 'Profile avatar'}
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-full object-cover border border-[var(--ps-border)]"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]">
                  <User className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                    {user.email}
                  </p>
                  {isGoogleSyncedAccount && (
                    <span
                      data-testid="onboarding-google-synced-badge"
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      <span>Google Synced</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Read-only verified account email · Photo synced from Google.
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="onboarding-fullname"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Full Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="onboarding-fullname"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, fullName: true }))
                }
                placeholder="e.g. Liani Guite"
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
              />
              {(touched.fullName || step1SubmitAttempted) &&
                step1Errors.fullName && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {step1Errors.fullName}
                  </p>
                )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="onboarding-username"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Username Handle <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--ps-text-muted)]">
                  @
                </span>
                <input
                  id="onboarding-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(formatUsername(e.target.value))}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, username: true }))
                  }
                  placeholder="lamka_explorer"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-3.5 text-sm font-mono text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                />
              </div>
              {(touched.username || step1SubmitAttempted) &&
                step1Errors.username && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {step1Errors.username}
                  </p>
                )}
            </div>

            <div className="space-y-1">
              <PhoneInput
                label="Mobile Number (+91) *"
                value={phone}
                onChange={(val) => {
                  setPhone(val);
                  setTouched((prev) => ({ ...prev, phone: true }));
                }}
                error={
                  touched.phone || step1SubmitAttempted
                    ? step1Errors.phone
                    : undefined
                }
                required
              />
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Used for shop enquiries, delivery drivers &amp; WhatsApp contact.
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="onboarding-locality"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Preferred {activeHub?.name || 'Churachandpur'} Locality{' '}
                <span className="text-rose-500">*</span>
              </label>
              <CustomSelectModal
                id="onboarding-locality"
                testId="onboarding-locality"
                label={`Preferred ${activeHub?.name || 'Churachandpur'} Locality`}
                options={localityOptions}
                value={preferredLocality}
                onChange={(val) => setPreferredLocality(val)}
                placeholder="Select your locality"
              />
            </div>

            {/* Set Account Password section for brand-new Google OAuth accounts */}
            {requiresGooglePasswordSetup && (
              <div
                data-testid="onboarding-google-password-section"
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-xs font-extrabold text-[var(--ps-text)]">
                      Set Account Password
                    </h2>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      Create a password once so you can sign in with either
                      Google or your email &amp; password anytime.
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="onboarding-password"
                    className="block text-xs font-bold text-[var(--ps-text)]"
                  >
                    Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="onboarding-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() =>
                        setTouched((prev) => ({ ...prev, password: true }))
                      }
                      placeholder="Create a strong password"
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-3.5 pr-11 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {(touched.password || step1SubmitAttempted) &&
                    step1Errors.password && (
                      <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        {step1Errors.password}
                      </p>
                    )}

                  {/* Password strength checklist */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                    {[
                      {
                        ok: passwordStrength.minLength,
                        label: '8+ characters',
                      },
                      {
                        ok: passwordStrength.hasUpper,
                        label: '1 uppercase (A-Z)',
                      },
                      {
                        ok: passwordStrength.hasLower,
                        label: '1 lowercase (a-z)',
                      },
                      {
                        ok: passwordStrength.hasNumber,
                        label: '1 number (0-9)',
                      },
                      {
                        ok: passwordStrength.hasSpecial,
                        label: '1 symbol (@$!%*?&.#^_-)',
                      },
                    ].map((rule) => (
                      <div
                        key={rule.label}
                        className={`inline-flex items-center gap-1 ${
                          rule.ok
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-[var(--ps-text-muted)]'
                        }`}
                      >
                        <Check className="h-3 w-3 shrink-0" />
                        <span>{rule.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="onboarding-confirm-password"
                    className="block text-xs font-bold text-[var(--ps-text)]"
                  >
                    Confirm Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="onboarding-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() =>
                        setTouched((prev) => ({
                          ...prev,
                          confirmPassword: true,
                        }))
                      }
                      placeholder="Re-enter your password"
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-3.5 pr-11 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={
                        showConfirmPassword
                          ? 'Hide confirm password'
                          : 'Show confirm password'
                      }
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {(touched.confirmPassword || step1SubmitAttempted) &&
                    step1Errors.confirmPassword && (
                      <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        {step1Errors.confirmPassword}
                      </p>
                    )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isStep1Submitting}
              data-testid="onboarding-step1-next-btn"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-sm font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity disabled:opacity-60 cursor-pointer"
            >
              {isStep1Submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving Account Password…</span>
                </>
              ) : (
                <>
                  <span>Continue to Step 2</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: Role Intent Cards */}
        {step === 2 && (
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 space-y-4 shadow-xs">
            <p className="text-xs text-[var(--ps-text-muted)]">
              Pick your main goal right now — you can switch hats or apply for
              verified Partner/Driver KYC anytime later.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ROLE_INTENT_CARDS.map((card) => {
                const Icon = card.icon;
                const active = selectedIntent === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setSelectedIntent(card.id)}
                    data-testid={`onboarding-intent-${card.id}`}
                    className={`min-h-[110px] rounded-2xl border p-4 text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                      active
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 ring-2 ring-[var(--ps-accent)]/25'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)]/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                          active
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                            : 'bg-[var(--ps-surface)] text-[var(--ps-accent)] border border-[var(--ps-border)]'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      {active && (
                        <CheckCircle2 className="h-4 w-4 text-[var(--ps-accent)]" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-extrabold text-[var(--ps-text)]">
                        {card.title}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ps-text-muted)]">
                        {card.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isSaving}
                className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => void handleCompleteOnboarding()}
                disabled={isSaving}
                data-testid="onboarding-finish-btn"
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-sm font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity disabled:opacity-60 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Saving Setup…</span>
                  </>
                ) : (
                  <>
                    <span>Finish &amp; Launch</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Quick access to Partner / Driver KYC Application Center & Role Guides */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <Briefcase className="h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
              <span className="text-[var(--ps-text-muted)]">
                Submitting Business Owner, Driver, or Advertiser KYC documents?
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowPartnerKyc(true)}
              className="min-h-[44px] shrink-0 font-bold text-[var(--ps-accent)] hover:underline cursor-pointer px-2"
            >
              Open KYC Center
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <Compass className="h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
              <span className="text-[var(--ps-text-muted)]">
                Want a walkthrough of all 8 roles, escrow rules &amp; quick checklists?
              </span>
            </div>
            <Link
              href="/guides"
              className="min-h-[44px] inline-flex items-center shrink-0 font-bold text-[var(--ps-accent)] hover:underline px-2"
            >
              Read Role Guides →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--ps-bg)] px-4 py-10 text-[var(--ps-text)]">
          <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6">
            <div className="dd-shimmer h-5 w-36 rounded-lg" />
            <div className="dd-shimmer h-8 w-3/4 rounded-xl" />
            <div className="dd-shimmer h-12 w-full rounded-xl" />
            <div className="dd-shimmer h-12 w-full rounded-xl" />
          </div>
        </main>
      }
    >
      <GuidedOnboardingInner />
    </Suspense>
  );
}
