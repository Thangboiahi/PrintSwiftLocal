'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Chrome,
  Compass,
  KeyRound,
  Loader2,
  LogIn,
  Phone,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import {
  checkUserNeedsOnboarding,
  setAuthStoreState,
  signInWithGoogleOAuth,
  signInWithPhoneOtp,
  verifyPhoneOtp,
} from '@/lib/auth';

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

export default function LoginPage() {
  const router = useRouter();
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    if (isLoading || isOAuthLoading) return;
    setIsOAuthLoading(true);
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
      setIsOAuthLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullPhone = resolveFullPhoneNumber(countryCode, phone);
    if (!fullPhone || !PHONE_REGEX.test(fullPhone)) {
      setErrorMessage(
        'Please enter a valid mobile number (e.g., 9862000000 with +91).'
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await signInWithPhoneOtp(fullPhone);
      setOtpSent(true);
      setSuccessMessage(
        `One-time verification code sent to ${fullPhone}. Enter your 6-digit OTP below.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to send SMS OTP. Verify your Supabase Phone Auth configuration.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullPhone = resolveFullPhoneNumber(countryCode, phone);
    const trimmedOtp = otpToken.trim();
    if (!trimmedOtp) {
      setErrorMessage('Please enter the 6-digit OTP sent to your phone.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await verifyPhoneOtp(fullPhone, trimmedOtp);
      if (data.user?.id) {
        const needsOnboarding = await checkUserNeedsOnboarding(data.user.id);
        if (needsOnboarding) {
          router.push('/onboarding');
          return;
        }
      }
      router.push('/profile');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Invalid or expired OTP code. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter both your email address and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
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
      if (data.user?.id) {
        const needsOnboarding = await checkUserNeedsOnboarding(data.user.id);
        if (needsOnboarding) {
          router.push('/onboarding');
          return;
        }
      }
      router.push('/profile');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to sign in. Verify your Supabase configuration and credentials.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-[var(--ps-text)]">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Discovery Map</span>
          </Link>
          <Link
            href="/signup"
            className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
          >
            Need an account? Sign Up →
          </Link>
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 sm:p-8 shadow-sm space-y-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              <Compass className="h-3.5 w-3.5" />
              <span>PrintSwift Local</span>
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Sign In to Your Account
            </h1>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Access your saved Churachandpur listings, owner workspace, and verification tools.
            </p>
          </div>

          {errorMessage && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* 1. Sign in with Google */}
          <button
            type="button"
            disabled={isLoading || isOAuthLoading}
            onClick={handleGoogleSignIn}
            data-testid="login-google-btn"
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-text)] shadow-sm transition hover:bg-[var(--ps-surface-alt)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            {isOAuthLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
                <span>Redirecting to Google…</span>
              </>
            ) : (
              <>
                <Chrome className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Sign in with Google</span>
              </>
            )}
          </button>

          {/* Clean Divider 1 */}
          <div className="relative flex items-center">
            <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
            <span className="shrink-0 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Or passwordless SMS
            </span>
            <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
          </div>

          {/* 2. Sign in with Phone (OTP) */}
          <button
            type="button"
            disabled={isLoading || isOAuthLoading}
            onClick={() => {
              setAuthMethod((prev) => (prev === 'phone' ? 'email' : 'phone'));
              setOtpSent(false);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            data-testid="login-phone-toggle-btn"
            className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              authMethod === 'phone'
                ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
            }`}
          >
            <Phone className="h-4 w-4 text-[var(--ps-accent)]" />
            <span>
              {authMethod === 'phone'
                ? 'Switch to Email & Password'
                : 'Sign in with Phone (OTP)'}
            </span>
          </button>

          {/* Clean Divider 2 */}
          <div className="relative flex items-center">
            <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
            <span className="shrink-0 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
              {authMethod === 'phone'
                ? 'Phone OTP Verification'
                : 'Email & Password'}
            </span>
            <div className="flex-grow border-t border-gray-200 dark:border-gray-800" />
          </div>

          {/* 3. Active Form (Phone OTP or Email/Password) */}
          {authMethod === 'phone' ? (
            <form
              onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="login-phone"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  Mobile Number
                </label>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Country code"
                    data-testid="login-country-code-select"
                    disabled={isLoading || otpSent}
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
                    <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                    <input
                      id="login-phone"
                      type="tel"
                      required
                      disabled={isLoading || otpSent}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="98620 00000"
                      className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] py-2.5 pl-10 pr-3.5 text-xs text-[var(--ps-text)] transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>

              {otpSent && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-otp"
                    className="block text-xs font-semibold text-[var(--ps-text)]"
                  >
                    6-Digit Verification Code
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                    <input
                      id="login-otp"
                      type="text"
                      inputMode="numeric"
                      required
                      disabled={isLoading}
                      value={otpToken}
                      onChange={(e) => setOtpToken(e.target.value)}
                      placeholder="123456"
                      className="w-full min-h-[44px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] py-2.5 pl-10 pr-3.5 text-xs font-mono tracking-widest text-[var(--ps-text)] transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{otpSent ? 'Verifying…' : 'Sending OTP…'}</span>
                  </>
                ) : (
                  <span>
                    {otpSent ? 'Verify & Sign In' : 'Send Verification Code'}
                  </span>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 pt-2">
              <div className="relative">
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email Address"
                  className="peer w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 placeholder-transparent focus:border-blue-600 focus:outline-none focus:ring-0 text-sm text-[var(--ps-text)] dark:border-gray-700"
                />
                <label
                  htmlFor="login-email"
                  className="pointer-events-none absolute left-0 -top-3.5 text-xs font-medium text-[var(--ps-text-muted)] transition-all peer-placeholder-shown:top-2 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-400 peer-focus:-top-3.5 peer-focus:text-xs peer-focus:text-blue-600"
                >
                  Email Address
                </label>
              </div>

              <div className="relative pt-1">
                <input
                  id="login-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="peer w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 placeholder-transparent focus:border-blue-600 focus:outline-none focus:ring-0 text-sm text-[var(--ps-text)] dark:border-gray-700"
                />
                <label
                  htmlFor="login-password"
                  className="pointer-events-none absolute left-0 -top-2.5 text-xs font-medium text-[var(--ps-text-muted)] transition-all peer-placeholder-shown:top-3 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-400 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-blue-600"
                >
                  Password
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing In…</span>
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
