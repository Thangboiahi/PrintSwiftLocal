'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Compass,
  Loader2,
  Phone,
  Sparkles,
  User,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth';
import { ProfileSkeleton } from '@/components/shared/Skeletons';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';

type OnboardingRoleOption = 'visitor' | 'owner';

const NAME_REGEX = /^[a-zA-Z\s.'-]{2,80}$/;
const PHONE_REGEX = /^\+?[1-9][0-9\s-]{9,14}$/;

function OnboardingContent() {
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedRole, setSelectedRole] =
    useState<OnboardingRoleOption>('visitor');

  const [nameError, setNameError] = useState<string | null>(null);
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
        .select('id, full_name, name, phone, role, role_type')
        .eq('id', activeUser.id)
        .maybeSingle();

      if (!active) return;

      const typedProfile = profileRow as {
        full_name?: string | null;
        name?: string | null;
        phone?: string | null;
        role?: string | null;
        role_type?: string | null;
      } | null;

      if (typedProfile?.full_name || typedProfile?.name || metaName) {
        setFullName(
          String(typedProfile?.full_name || typedProfile?.name || metaName)
        );
      }

      if (typedProfile?.phone || metaPhone) {
        setPhone(String(typedProfile?.phone || metaPhone));
      }

      if (typedProfile?.role || typedProfile?.role_type) {
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

  const validateStepOne = (): boolean => {
    const cleanedName = fullName.trim();
    const cleanedPhone = phone.trim();
    let isValid = true;

    if (!cleanedName || cleanedName.length < 2) {
      setNameError('Please enter your full name (at least 2 characters).');
      isValid = false;
    } else if (!NAME_REGEX.test(cleanedName)) {
      setNameError(
        'Name may only contain letters, spaces, periods, hyphens, or apostrophes.'
      );
      isValid = false;
    } else {
      setNameError(null);
    }

    const normalizedPhone = cleanedPhone.replace(/[\s-]+/g, '');
    if (!normalizedPhone || !PHONE_REGEX.test(normalizedPhone)) {
      setPhoneError(
        'Please enter a valid 10–15 digit phone number (e.g., +91 98620 11223).'
      );
      isValid = false;
    } else {
      setPhoneError(null);
    }

    return isValid;
  };

  const handleStepOneNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStepOne()) {
      setErrorMessage(
        'Please review and fix the highlighted account information fields.'
      );
      return;
    }
    setErrorMessage(null);
    setStep(2);
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateStepOne()) {
      setStep(1);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const cleanedName = fullName.trim();
      const cleanedPhone = phone.trim();

      if (isSupabaseConfigured()) {
        const { data: sessionData } = await supabase.auth.getSession();
        const activeUser = sessionData?.session?.user ?? user;

        if (activeUser?.id) {
          const { error: upsertError } = await supabase
            .from('profiles')
            .upsert(
              {
                id: activeUser.id,
                email: activeUser.email ?? null,
                full_name: cleanedName,
                name: cleanedName,
                phone: cleanedPhone || null,
                role: selectedRole,
                role_type: selectedRole,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'id' }
            );

          if (upsertError) {
            const { error: fallbackUpdateError } = await supabase
              .from('profiles')
              .update({
                full_name: cleanedName,
                phone: cleanedPhone || null,
                role: selectedRole,
              })
              .eq('id', activeUser.id);

            if (fallbackUpdateError) {
              throw new Error(fallbackUpdateError.message);
            }
          }
        }
      }

      router.push('/');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to save your onboarding profile. Please try again.'
      );
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
        {/* Brand Header & Step Progress Indicator */}
        <div className="space-y-4 border-b border-gray-200 dark:border-gray-800 pb-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <span className="text-sm font-extrabold tracking-tight text-[var(--ps-text)] block">
                  PrintSwift Local
                </span>
                <span className="text-[11px] text-[var(--ps-text-muted)]">
                  Account Setup &amp; Role Onboarding
                </span>
              </div>
            </div>

            <span className="px-3 py-1 rounded-full bg-[var(--ps-surface-alt)] border border-gray-200 dark:border-gray-800 text-xs font-semibold text-[var(--ps-text)]">
              Step {step} of 2
            </span>
          </div>

          {/* Minimalist 2-Step Progress Bar */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div
                className={`h-1.5 rounded-full transition-colors ${
                  step >= 1
                    ? 'bg-blue-600 dark:bg-blue-500'
                    : 'bg-gray-200 dark:bg-gray-800'
                }`}
              />
              <span className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                1. Account Info
              </span>
            </div>
            <div className="space-y-1">
              <div
                className={`h-1.5 rounded-full transition-colors ${
                  step === 2
                    ? 'bg-blue-600 dark:bg-blue-500'
                    : 'bg-gray-200 dark:bg-gray-800'
                }`}
              />
              <span className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                2. Select Role
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

        {/* STEP 1: ACCOUNT INFO (NAME & PHONE VALIDATION) */}
        {step === 1 ? (
          <form
            onSubmit={handleStepOneNext}
            noValidate
            data-testid="onboarding-step-1"
            className="space-y-5"
          >
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Welcome to Lamka&apos;s Directory</span>
              </div>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                Set up your account details
              </h1>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)] leading-relaxed">
                Your name and contact number help verify enquiries, community reviews, and business listings across Churachandpur.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="onboarding-full-name"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  Full Name or Display Name <span className="text-rose-500">*</span>
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
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="e.g., Thangboi Haokip"
                    data-testid="onboarding-name-input"
                    className={`w-full min-h-[44px] rounded-xl border bg-[var(--ps-bg)] pl-10 pr-4 py-2.5 text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      nameError
                        ? 'border-rose-500'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  />
                </div>
                {nameError && (
                  <p
                    role="alert"
                    data-testid="onboarding-name-error"
                    className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
                  >
                    {nameError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="onboarding-phone"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  Contact Phone / WhatsApp Number <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="onboarding-phone"
                    type="tel"
                    required
                    aria-invalid={Boolean(phoneError)}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (phoneError) setPhoneError(null);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="+91 98620 11223"
                    data-testid="onboarding-phone-input"
                    className={`w-full min-h-[44px] rounded-xl border bg-[var(--ps-bg)] pl-10 pr-4 py-2.5 text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      phoneError
                        ? 'border-rose-500'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  />
                </div>
                {phoneError ? (
                  <p
                    role="alert"
                    data-testid="onboarding-phone-error"
                    className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
                  >
                    {phoneError}
                  </p>
                ) : (
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Include country code (e.g., +91) or a 10-digit mobile number.
                  </p>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                data-testid="onboarding-next-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <span>Continue to Role Selection</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        ) : (
          /* STEP 2: ROLE SELECTION */
          <form
            onSubmit={handleCompleteOnboarding}
            data-testid="onboarding-step-2"
            className="space-y-5"
          >
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                How will you use PrintSwift Local?
              </h1>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)] leading-relaxed">
                Choose your primary workspace experience. You can always explore the public map regardless of your choice.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {/* Role Option 1: Visitor / Discover */}
              <button
                type="button"
                onClick={() => setSelectedRole('visitor')}
                data-testid="onboarding-role-visitor"
                aria-pressed={selectedRole === 'visitor'}
                className={`flex items-start gap-3.5 rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  selectedRole === 'visitor'
                    ? 'border-blue-600 bg-blue-500/10 ring-1 ring-blue-500/30'
                    : 'border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  <Compass className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[var(--ps-text)]">
                      I am looking for places
                    </span>
                    {selectedRole === 'visitor' && (
                      <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                    Browse verified local businesses, services, and real estate listings with 360° virtual tours, directions, and reviews.
                  </p>
                </div>
              </button>

              {/* Role Option 2: Owner / List Business or Property */}
              <button
                type="button"
                onClick={() => setSelectedRole('owner')}
                data-testid="onboarding-role-owner"
                aria-pressed={selectedRole === 'owner'}
                className={`flex items-start gap-3.5 rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  selectedRole === 'owner'
                    ? 'border-emerald-600 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                    : 'border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[var(--ps-text)]">
                      I am a business owner
                    </span>
                    {selectedRole === 'owner' && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                    Publish and manage business profiles, real estate plots with 360° panoramas, respond to visitor enquiries, and delegate staff.
                  </p>
                </div>
              </button>
            </div>

            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setStep(1)}
                data-testid="onboarding-back-btn"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back</span>
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="onboarding-submit-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
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
            </div>
          </form>
        )}
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
