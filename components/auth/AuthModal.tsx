'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Chrome,
  KeyRound,
  Loader2,
  LogIn,
  Phone,
  UserPlus,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import {
  checkUserNeedsOnboarding,
  setAuthStoreState,
  signInWithGoogleOAuth,
  signInWithPhoneOtp,
  verifyPhoneOtp,
} from '@/lib/auth';
import {
  isTopmostActiveModal,
  useModalFocusManagement,
} from '@/components/shared/ThemeSettingsModal';

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9][0-9\s-]{7,15}$/;

const COUNTRY_CODES = [
  { code: '+91', label: 'IN (+91)' },
  { code: '+1', label: 'US (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+65', label: 'SG (+65)' },
  { code: '+61', label: 'AU (+61)' },
  { code: '+971', label: 'AE (+971)' },
  { code: '+95', label: 'MM (+95)' },
  { code: '+880', label: 'BD (+880)' },
  { code: '+977', label: 'NP (+977)' },
] as const;

function resolveFullPhoneNumber(countryCode: string, rawPhone: string): string {
  const trimmed = rawPhone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return trimmed.replace(/[\s-]+/g, '');
  }
  return `${countryCode}${trimmed.replace(/^0+/, '').replace(/[\s-]+/g, '')}`;
}

export function AuthModal({ open, onClose }: AuthModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'login' | 'signup' | 'phone'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthSubmitting, setIsOAuthSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useModalFocusManagement({
    id: 'auth-modal',
    open,
    dialogRef,
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (!isTopmostActiveModal('auth-modal')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const validateFields = (): boolean => {
    const trimmedEmail = email.trim();
    let valid = true;

    if (!trimmedEmail) {
      setEmailError('Email address is required.');
      valid = false;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError(
        'Please enter a valid email address (e.g., name@domain.com).'
      );
      valid = false;
    } else {
      setEmailError(null);
    }

    if (!password) {
      setPasswordError('Password is required.');
      valid = false;
    } else if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters long.');
      valid = false;
    } else {
      setPasswordError(null);
    }

    return valid;
  };

  const handlePostAuthRedirect = async (userId?: string) => {
    onClose();
    if (userId) {
      const needsOnboarding = await checkUserNeedsOnboarding(userId);
      if (needsOnboarding) {
        router.push('/onboarding');
      }
    }
  };

  const handleGoogleSignIn = async () => {
    if (isOAuthSubmitting || isSubmitting) return;
    setIsOAuthSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await signInWithGoogleOAuth();
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Google OAuth sign-in failed. Verify your Supabase Google provider settings.'
      );
      setIsOAuthSubmitting(false);
    }
  };

  const handleSendPhoneOtp = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (isSubmitting) return;
    const fullPhone = resolveFullPhoneNumber(countryCode, phone);
    if (!fullPhone || !PHONE_REGEX.test(fullPhone)) {
      setPhoneError(
        'Please enter a valid mobile number (e.g., 9862000000 with +91).'
      );
      setErrorMessage(
        'Please enter a valid mobile number (e.g., 9862000000 with +91).'
      );
      return;
    }

    setPhoneError(null);
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await signInWithPhoneOtp(fullPhone);
      setOtpSent(true);
      setSuccessMessage(
        `One-time verification code sent to ${fullPhone}. Enter the 6-digit OTP below.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to send SMS OTP. Verify your Supabase Phone Auth configuration.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyPhoneOtp = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (isSubmitting) return;
    const fullPhone = resolveFullPhoneNumber(countryCode, phone);
    const trimmedOtp = otpToken.trim();
    if (!trimmedOtp) {
      setErrorMessage('Please enter the verification code sent to your phone.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const data = await verifyPhoneOtp(fullPhone, trimmedOtp);
      await handlePostAuthRedirect(data.user?.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Invalid or expired OTP code. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (isSubmitting) return;

    if (!validateFields()) {
      setErrorMessage(
        'Please correct the highlighted fields before continuing.'
      );
      return;
    }

    const trimmedEmail = email.trim();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          throw error;
        }
        setAuthStoreState({
          user: data.user ?? null,
          session: data.session ?? null,
          isLoading: false,
        });
        await handlePostAuthRedirect(data.user?.id);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          throw error;
        }
        if (data.session || data.user) {
          setAuthStoreState({
            user: data.user ?? null,
            session: data.session ?? null,
            isLoading: false,
          });
        }
        if (data.session) {
          await handlePostAuthRedirect(data.user?.id);
        } else {
          setSuccessMessage(
            'Account created! Please check your email inbox to confirm your registration.'
          );
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Authentication request failed. Verify your Supabase configuration and credentials.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      data-testid="auth-modal"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-3 sm:p-4 outline-none overflow-x-hidden overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[calc(100vw-24px)] sm:max-w-md max-h-[92dvh] overflow-x-hidden overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-sm ps-modal-card"
      >
        {/* Minimalist Modal Header */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="min-w-0">
            <h2
              id="auth-modal-title"
              tabIndex={-1}
              className="text-base font-extrabold tracking-tight text-[var(--ps-text)] outline-none truncate"
            >
              {mode === 'login'
                ? 'Sign In to PrintSwift Local'
                : mode === 'signup'
                  ? 'Create a PrintSwift Account'
                  : 'Sign In with Phone (OTP)'}
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
              {mode === 'login'
                ? 'Access your saved listings, enquiries, and property tools.'
                : mode === 'signup'
                  ? 'Register with Google, Phone OTP, or Email.'
                  : 'Receive a passwordless SMS verification code.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            data-testid="close-auth-modal-btn"
            className="min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher & Social/OTP Separation */}
        <div className="px-5 pt-4 space-y-3.5">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[var(--ps-bg)] border border-gray-200 dark:border-gray-800">
            <button
              type="button"
              disabled={isSubmitting || isOAuthSubmitting}
              onClick={() => {
                setMode('login');
                setEmailError(null);
                setPasswordError(null);
                setPhoneError(null);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              data-testid="auth-mode-login-btn"
              className={`min-h-[40px] py-1.5 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === 'login'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting || isOAuthSubmitting}
              onClick={() => {
                setMode('signup');
                setEmailError(null);
                setPasswordError(null);
                setPhoneError(null);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              data-testid="auth-mode-signup-btn"
              className={`min-h-[40px] py-1.5 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === 'signup'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign Up</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting || isOAuthSubmitting}
              onClick={() => {
                setMode('phone');
                setOtpSent(false);
                setEmailError(null);
                setPasswordError(null);
                setPhoneError(null);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              data-testid="auth-mode-phone-btn"
              className={`min-h-[40px] py-1.5 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === 'phone'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Phone className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Phone OTP</span>
            </button>
          </div>

          {/* 1. Sign in with Google */}
          <button
            type="button"
            disabled={isSubmitting || isOAuthSubmitting}
            onClick={handleGoogleSignIn}
            data-testid="auth-google-oauth-btn"
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] shadow-sm inline-flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            {isOAuthSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[var(--ps-accent)]" />
                <span>Redirecting to Google…</span>
              </>
            ) : (
              <>
                <Chrome className="w-4 h-4 text-[var(--ps-accent)]" />
                <span>Sign in with Google</span>
              </>
            )}
          </button>

          {/* Clean Divider 1 */}
          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
            <span className="shrink-0 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
              {mode === 'phone'
                ? 'Or verify with Phone (OTP)'
                : 'Or quick Phone (OTP) / Email'}
            </span>
            <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
          </div>

          {/* 2. Dedicated Quick Switch to Sign in with Phone (OTP) when in Email mode */}
          {mode !== 'phone' && (
            <>
              <button
                type="button"
                disabled={isSubmitting || isOAuthSubmitting}
                onClick={() => {
                  setMode('phone');
                  setOtpSent(false);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className="w-full min-h-[42px] py-2 px-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <Phone className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                <span>Sign in with Phone (OTP)</span>
              </button>

              {/* Clean Divider 2 separating Phone OTP and Email/Password */}
              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
                <span className="shrink-0 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Email &amp; Password
                </span>
                <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
              </div>
            </>
          )}
        </div>

        {/* Form Body */}
        {mode === 'phone' ? (
          <form
            onSubmit={otpSent ? handleVerifyPhoneOtp : handleSendPhoneOtp}
            noValidate
            className="p-5 pt-3 space-y-4"
          >
            {errorMessage && (
              <div
                role="status"
                aria-live="polite"
                data-testid="auth-error-banner"
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div
                role="status"
                aria-live="polite"
                data-testid="auth-success-banner"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="auth-phone-input"
                className="block text-xs font-semibold text-[var(--ps-text)]"
              >
                Mobile Number
              </label>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Country code"
                  data-testid="auth-country-code-select"
                  disabled={isSubmitting || otpSent}
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-2.5 py-2 text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                >
                  {COUNTRY_CODES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <div className="relative flex-1">
                  <Phone className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-phone-input"
                    type="tel"
                    required
                    disabled={isSubmitting || otpSent}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (phoneError) setPhoneError(null);
                    }}
                    placeholder="98620 00000"
                    data-testid="auth-phone-input"
                    className={`w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--ps-bg)] border text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60 ${
                      phoneError
                        ? 'border-rose-500'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  />
                </div>
              </div>
              {phoneError && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {phoneError}
                </p>
              )}
            </div>

            {otpSent && (
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-otp-input"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  6-Digit SMS Verification Code
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-otp-input"
                    type="text"
                    inputMode="numeric"
                    required
                    disabled={isSubmitting}
                    value={otpToken}
                    onChange={(e) => setOtpToken(e.target.value)}
                    placeholder="123456"
                    data-testid="auth-otp-input"
                    className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--ps-bg)] border border-gray-200 dark:border-gray-800 text-xs font-mono tracking-widest text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="auth-phone-submit-btn"
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{otpSent ? 'Verifying OTP…' : 'Sending OTP…'}</span>
                </>
              ) : (
                <span>
                  {otpSent ? 'Verify & Sign In' : 'Sign in with Phone (OTP)'}
                </span>
              )}
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="p-5 pt-3 space-y-4"
          >
            {errorMessage && (
              <div
                role="status"
                aria-live="polite"
                data-testid="auth-error-banner"
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
              >
                <AlertCircle
                  className="w-4 h-4 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div
                role="status"
                aria-live="polite"
                data-testid="auth-success-banner"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2"
              >
                <CheckCircle2
                  className="w-4 h-4 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>{successMessage}</span>
              </div>
            )}

            <div className="space-y-1 pt-3">
              <div className="relative">
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  disabled={isSubmitting}
                  autoComplete="email"
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'auth-email-error' : undefined}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  placeholder="Email Address"
                  data-testid="auth-email-input"
                  className={`peer w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 placeholder-transparent focus:border-blue-600 focus:outline-none focus:ring-0 text-sm text-[var(--ps-text)] dark:border-gray-700 disabled:opacity-60 ${
                    emailError ? 'border-rose-500 focus:border-rose-500' : ''
                  }`}
                />
                <label
                  htmlFor="auth-email-input"
                  className="pointer-events-none absolute left-0 -top-3.5 text-xs font-medium text-[var(--ps-text-muted)] transition-all peer-placeholder-shown:top-2 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-400 peer-focus:-top-3.5 peer-focus:text-xs peer-focus:text-blue-600"
                >
                  Email Address
                </label>
              </div>
              {emailError && (
                <p
                  id="auth-email-error"
                  role="alert"
                  className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
                >
                  {emailError}
                </p>
              )}
            </div>

            <div className="space-y-1 pt-3">
              <div className="relative">
                <input
                  id="auth-password-input"
                  type="password"
                  required
                  minLength={6}
                  disabled={isSubmitting}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={
                    passwordError ? 'auth-password-error' : undefined
                  }
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                  }}
                  placeholder="Password"
                  data-testid="auth-password-input"
                  className={`peer w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 placeholder-transparent focus:border-blue-600 focus:outline-none focus:ring-0 text-sm text-[var(--ps-text)] dark:border-gray-700 disabled:opacity-60 ${
                    passwordError ? 'border-rose-500 focus:border-rose-500' : ''
                  }`}
                />
                <label
                  htmlFor="auth-password-input"
                  className="pointer-events-none absolute left-0 -top-3.5 text-xs font-medium text-[var(--ps-text-muted)] transition-all peer-placeholder-shown:top-2 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-400 peer-focus:-top-3.5 peer-focus:text-xs peer-focus:text-blue-600"
                >
                  Password
                </label>
              </div>
              {passwordError && (
                <p
                  id="auth-password-error"
                  role="alert"
                  className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
                >
                  {passwordError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="auth-submit-btn"
              className="w-full min-h-[44px] min-w-[44px] py-2.5 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>
                    {mode === 'login' ? 'Signing In…' : 'Creating Account…'}
                  </span>
                </>
              ) : (
                <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
export default AuthModal;
