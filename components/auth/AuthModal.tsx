'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Chrome,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { syncAuthenticatedProfileRole } from '@/lib/auth';
import { isDemoAuthEnabled, sanitizeRelativeNextPath } from '@/lib/env';
import {
  EMAIL_REGEX,
  getPasswordStrength,
  mapSupabaseAuthError,
} from '@/lib/validators';
import { TestRoleShortcuts } from '@/components/auth/TestRoleShortcuts';
import { useModalLock } from '@/hooks/useModalLock';

export interface AuthModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  initialView?: 'login' | 'signup';
}

type AuthView = 'login' | 'signup' | 'recovery';

export function AuthModal({
  open,
  isOpen,
  onClose,
  initialView = 'login',
}: AuthModalProps) {
  const modalOpen = open ?? isOpen ?? false;
  useModalLock(modalOpen);
  const router = useRouter();

  const [view, setView] = useState<AuthView>(initialView);
  const [nextPath, setNextPath] = useState<string>('/');

  // Form values
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Touched / Submit validation flags (field on blur/input, full form on submit)
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Action states
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const fullNameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();

  // Read ?error=oauth and ?next= safely on mount when opened
  useEffect(() => {
    if (!modalOpen || typeof window === 'undefined') return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const safeNext = sanitizeRelativeNextPath(params.get('next'), '/');
      setNextPath(safeNext);
      const oauthErr = params.get('error');
      if (oauthErr === 'oauth') {
        setErrorMessage(
          'Google sign-in could not be completed. Please try again or sign in with your email and password.'
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [modalOpen]);

  const markTouched = (field: string) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const passwordStrength = useMemo(
    () => getPasswordStrength(password),
    [password]
  );

  // Strict field validation (displayed only when touched[field] || submitAttempted)
  const fieldErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      errs.email = 'Email address is required.';
    } else if (!EMAIL_REGEX.test(cleanEmail)) {
      errs.email = 'Enter a valid email address.';
    }

    if (view === 'login') {
      if (!password) {
        errs.password = 'Password is required.';
      } else if (password.length < 6) {
        errs.password = 'Password must be at least 6 characters.';
      }
    }

    if (view === 'signup') {
      const cleanName = fullName.trim();
      if (!cleanName) {
        errs.fullName = 'Full name is required.';
      } else if (cleanName.length < 2) {
        errs.fullName = 'Enter at least 2 characters.';
      }
      if (!password) {
        errs.password = 'Create a password (at least 8 characters).';
      } else if (password.length < 8) {
        errs.password = 'Password must be at least 8 characters.';
      }
      if (!confirmPassword) {
        errs.confirmPassword = 'Please confirm your password.';
      } else if (confirmPassword !== password) {
        errs.confirmPassword = 'Passwords do not match.';
      }
    }

    return errs;
  }, [email, password, confirmPassword, fullName, view]);

  const showError = (field: string): string | null =>
    touched[field] || submitAttempted ? fieldErrors[field] || null : null;

  const isFormValid = Object.keys(fieldErrors).length === 0;

  const switchView = (nextView: AuthView) => {
    setView(nextView);
    setErrorMessage(null);
    setInfoMessage(null);
    setTouched({});
    setSubmitAttempted(false);
    setPassword('');
    setConfirmPassword('');
  };

  if (!modalOpen) return null;

  const demoAuthAllowed = isDemoAuthEnabled();

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    if (!isSupabaseConfigured()) {
      setErrorMessage(
        'Authentication service is not configured in this environment.'
      );
      return;
    }

    setIsGoogleLoading(true);
    try {
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      if (nextPath && nextPath !== '/') {
        callbackUrl.searchParams.set('next', nextPath);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        throw new Error(mapSupabaseAuthError(error));
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not launch Google sign-in. Please try again.'
      );
      setIsGoogleLoading(false);
    }
  };

  const routeAfterEmailAuth = async (userId: string) => {
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('onboarding_completed_at')
        .eq('id', userId)
        .maybeSingle();

      const completedAt =
        profileRow &&
        typeof (profileRow as { onboarding_completed_at?: unknown })
          .onboarding_completed_at === 'string'
          ? (profileRow as { onboarding_completed_at: string })
              .onboarding_completed_at
          : null;

      onClose();
      if (!completedAt && !nextPath.startsWith('/onboarding')) {
        const dest =
          nextPath && nextPath !== '/'
            ? `/onboarding?next=${encodeURIComponent(nextPath)}`
            : '/onboarding';
        router.push(dest);
      } else {
        router.push(nextPath || '/');
      }
      router.refresh();
    } catch {
      onClose();
      router.push(nextPath || '/');
      router.refresh();
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setErrorMessage(null);
    setInfoMessage(null);

    if (!isFormValid) {
      return;
    }

    if (!isSupabaseConfigured()) {
      setErrorMessage(
        'Authentication service is not configured in this environment.'
      );
      return;
    }

    setIsSubmitting(true);
    const cleanEmail = email.trim().toLowerCase();

    try {
      if (view === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error || !data?.user) {
          throw new Error(
            error ? mapSupabaseAuthError(error) : 'Invalid email or password.'
          );
        }

        await syncAuthenticatedProfileRole(data.user, data.session ?? null);
        await routeAfterEmailAuth(data.user.id);
        return;
      }

      if (view === 'signup') {
        const cleanName = fullName.trim();
        const callbackUrl = new URL('/auth/callback', window.location.origin);
        if (nextPath && nextPath !== '/') {
          callbackUrl.searchParams.set('next', nextPath);
        }

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: callbackUrl.toString(),
            data: {
              full_name: cleanName,
            },
          },
        });

        if (error) {
          throw new Error(mapSupabaseAuthError(error));
        }

        if (data.session && data.user) {
          await syncAuthenticatedProfileRole(data.user, data.session);
          await routeAfterEmailAuth(data.user.id);
          return;
        }

        setInfoMessage(
          `Confirmation link sent to ${cleanEmail}. Open your inbox to activate your account and complete your 2-step setup.`
        );
        return;
      }

      // Password recovery via Supabase email
      const resetCallback = new URL('/auth/callback', window.location.origin);
      resetCallback.searchParams.set('next', '/profile/edit');

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: resetCallback.toString(),
      });

      if (error) {
        throw new Error(mapSupabaseAuthError(error));
      }

      setInfoMessage(
        `Password reset instructions sent to ${cleanEmail}. Check your inbox and spam folder.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Authentication request failed. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dd-auth-modal-title"
      data-testid="auth-modal"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>DD oodle Account</span>
            </div>
            <h2
              id="dd-auth-modal-title"
              className="mt-0.5 text-lg font-extrabold tracking-tight text-[var(--ps-text)]"
            >
              {view === 'login'
                ? 'Welcome back'
                : view === 'signup'
                  ? 'Create your account'
                  : 'Reset your password'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              {view === 'login'
                ? 'Sign in with Google or your email to access bookings, saved places & workspaces.'
                : view === 'signup'
                  ? 'Fast 1-tap Google sign-up or email. You will add your +91 contact during setup.'
                  : 'We will email you a secure password recovery link.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Mode Switcher Tabs (Login / Sign Up) */}
          {view !== 'recovery' ? (
            <div
              className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === 'login'}
                onClick={() => switchView('login')}
                className={`min-h-[44px] rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  view === 'login'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'signup'}
                onClick={() => switchView('signup')}
                className={`min-h-[44px] rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  view === 'signup'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                Create Account
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => switchView('login')}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-bold text-[var(--ps-accent)] hover:underline cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Sign In</span>
            </button>
          )}

          {/* Error / Info Alerts */}
          {errorMessage && (
            <div
              role="alert"
              data-testid="auth-error-banner"
              className="flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {infoMessage && (
            <div
              role="status"
              data-testid="auth-info-banner"
              className="flex items-start gap-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{infoMessage}</span>
            </div>
          )}

          {/* Primary 1-Tap Google OAuth Button */}
          {view !== 'recovery' && (
            <>
              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                disabled={isGoogleLoading || isSubmitting}
                data-testid="auth-google-oauth-btn"
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-sm font-bold text-[var(--ps-text)] shadow-xs hover:border-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {isGoogleLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
                    <span>Connecting to Google…</span>
                  </>
                ) : (
                  <>
                    <Chrome className="h-4 w-4 text-[var(--ps-accent)]" />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-[var(--ps-border)]" />
                <span className="mx-3 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  or continue with email
                </span>
                <div className="flex-grow border-t border-[var(--ps-border)]" />
              </div>
            </>
          )}

          {/* Email & Password Fallback Form */}
          <form onSubmit={handleEmailSubmit} noValidate className="space-y-3.5">
            {view === 'signup' && (
              <div className="space-y-1">
                <label
                  htmlFor={fullNameId}
                  className="block text-xs font-bold text-[var(--ps-text)]"
                >
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id={fullNameId}
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={() => markTouched('fullName')}
                  placeholder="e.g. Thangboi Haokip"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                />
                {showError('fullName') && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {showError('fullName')}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <label
                htmlFor={emailId}
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Email Address <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                <input
                  id={emailId}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markTouched('email')}
                  placeholder="you@example.com"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                />
              </div>
              {showError('email') && (
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                  {showError('email')}
                </p>
              )}
            </div>

            {view !== 'recovery' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={passwordId}
                    className="block text-xs font-bold text-[var(--ps-text)]"
                  >
                    Password <span className="text-rose-500">*</span>
                  </label>
                  {view === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchView('recovery')}
                      className="text-[11px] font-semibold text-[var(--ps-accent)] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                  <input
                    id={passwordId}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      view === 'login' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => markTouched('password')}
                    placeholder={
                      view === 'signup'
                        ? 'At least 8 characters'
                        : 'Enter your password'
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-12 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {view === 'signup' && password.length > 0 && (
                  <div className="flex items-center justify-between pt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                    <span>
                      Strength:{' '}
                      {passwordStrength.isValid
                        ? 'Strong'
                        : passwordStrength.minLength
                          ? 'Add upper, lower, number & symbol'
                          : 'At least 8 characters'}
                    </span>
                    <span className="font-mono">{password.length} chars</span>
                  </div>
                )}
                {showError('password') && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {showError('password')}
                  </p>
                )}
              </div>
            )}

            {view === 'signup' && (
              <div className="space-y-1">
                <label
                  htmlFor={confirmPasswordId}
                  className="block text-xs font-bold text-[var(--ps-text)]"
                >
                  Confirm Password <span className="text-rose-500">*</span>
                </label>
                <input
                  id={confirmPasswordId}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => markTouched('confirmPassword')}
                  placeholder="Re-enter your password"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/25"
                />
                {showError('confirmPassword') && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {showError('confirmPassword')}
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isGoogleLoading}
              data-testid="auth-email-submit-btn"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-sm font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity disabled:opacity-60 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Please wait…</span>
                </>
              ) : view === 'login' ? (
                <span>Sign In with Email</span>
              ) : view === 'signup' ? (
                <span>Create Account</span>
              ) : (
                <span>Send Password Reset Email</span>
              )}
            </button>
          </form>

          {/* Phase 44 Demo Auth Lock — Strictly opt-in via NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true' */}
          {demoAuthAllowed && view === 'login' && (
            <div className="pt-2 border-t border-[var(--ps-border)]">
              <TestRoleShortcuts
                compact
                onPrefillCredentials={(prefillEmail, prefillPassword) => {
                  setEmail(prefillEmail);
                  setPassword(prefillPassword);
                }}
                onNotice={(type, msg) => {
                  if (type === 'error') setErrorMessage(msg);
                  else setInfoMessage(msg);
                }}
                onSignedIn={() => {
                  onClose();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
