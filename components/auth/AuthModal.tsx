'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  UserPlus,
  LogIn,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { setAuthStoreState } from '@/lib/auth';
import {
  isTopmostActiveModal,
  useModalFocusManagement,
} from '@/components/shared/ThemeSettingsModal';

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthModal({ open, onClose }: AuthModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      setEmailError('Please enter a valid email address (e.g., name@domain.com).');
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

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (isSubmitting) return;

    if (!validateFields()) {
      setErrorMessage('Please correct the highlighted fields before continuing.');
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
        onClose();
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
          onClose();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 outline-none overflow-x-hidden overflow-y-auto ps-animate-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[calc(100vw-24px)] sm:max-w-md max-h-[92dvh] overflow-x-hidden overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl ps-animate-scale"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50">
          <div className="min-w-0">
            <h2
              id="auth-modal-title"
              tabIndex={-1}
              className="text-base font-extrabold tracking-tight text-[var(--ps-text)] outline-none truncate"
            >
              {mode === 'login'
                ? 'Sign In to PrintSwift Local'
                : 'Create a PrintSwift Account'}
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
              {mode === 'login'
                ? 'Access your saved listings, enquiries, and property tools.'
                : 'Register with your email and password to manage listings.'}
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

        {/* Mode Switcher Tabs */}
        <div className="px-4 sm:px-5 pt-4">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)]">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setMode('login');
                setEmailError(null);
                setPasswordError(null);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              data-testid="auth-mode-login-btn"
              className={`min-h-[44px] min-w-[44px] py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === 'login'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setMode('signup');
                setEmailError(null);
                setPasswordError(null);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              data-testid="auth-mode-signup-btn"
              className={`min-h-[44px] min-w-[44px] py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === 'signup'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign Up</span>
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} noValidate className="p-4 sm:p-5 space-y-4">
          {errorMessage && (
            <div
              role="status"
              aria-live="polite"
              data-testid="auth-error-banner"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
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
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="auth-email-input"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail
                className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
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
                placeholder="you@example.com"
                data-testid="auth-email-input"
                className={`w-full min-h-[44px] pl-9 pr-3.5 py-2.5 rounded-xl bg-[var(--ps-bg)] border text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60 ${
                  emailError ? 'border-rose-500' : 'border-[var(--ps-border)]'
                }`}
              />
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

          <div className="space-y-1.5">
            <label
              htmlFor="auth-password-input"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Password
            </label>
            <div className="relative">
              <Lock
                className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
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
                aria-describedby={passwordError ? 'auth-password-error' : undefined}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="••••••••"
                data-testid="auth-password-input"
                className={`w-full min-h-[44px] pl-9 pr-3.5 py-2.5 rounded-xl bg-[var(--ps-bg)] border text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60 ${
                  passwordError ? 'border-rose-500' : 'border-[var(--ps-border)]'
                }`}
              />
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
            className="w-full min-h-[44px] min-w-[44px] py-2.5 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-2 shadow-xs hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity cursor-pointer"
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
      </div>
    </div>
  );
}
export default AuthModal;
