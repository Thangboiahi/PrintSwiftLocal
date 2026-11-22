'use client';

import React, { useState, useEffect, useId } from 'react';
import {
  X,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  ArrowLeft,
  ShieldCheck,
  UserCheck,
  KeyRound,
  Mail,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { setAuthStoreState, syncAuthenticatedProfileRole } from '@/lib/auth';
import {
  EMAIL_REGEX,
  USERNAME_REGEX,
  PHONE_REGEX,
  OTP_REGEX,
  formatUsername,
  formatPhone,
  formatOtp,
  getPasswordStrength,
  resolveInitialRole,
  mapSupabaseAuthError,
  safeFetchJson,
} from '@/lib/validators';
import { AvatarCropUploader } from '@/components/auth/AvatarCropUploader';
import { PhoneCountryInput } from '@/components/auth/PhoneCountryInput';
import { useModalLock } from '@/hooks/useModalLock';

export interface AuthModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  initialView?: 'login' | 'signup';
}

type AuthView = 'login' | 'signup' | 'recovery' | 'welcome';
type SignupStep = '1' | '2A' | '2B';
type RecoveryStep = 1 | 2;

interface PasswordInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete?: string;
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete = 'current-password',
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        disabled={disabled}
        autoComplete={autoComplete}
        className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 pr-12 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
      />
      <label
        htmlFor={id}
        className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
      >
        {label}
      </label>
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        disabled={disabled}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function AuthModal({
  open,
  isOpen,
  onClose,
  initialView = 'login',
}: AuthModalProps) {
  const modalOpen = open ?? isOpen ?? false;
  useModalLock(modalOpen);

  const [view, setView] = useState<AuthView>(initialView);
  const [signupStep, setSignupStep] = useState<SignupStep>('1');
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>(1);

  // Shared / Login state & Stateless HMAC OTP token
  const [email, setEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [verificationToken, setVerificationToken] = useState<string>('');

  // Signup Step 1 state
  const [signupOtpSent, setSignupOtpSent] = useState(false);
  const [signupOtp, setSignupOtp] = useState('');

  // Signup Step 2A (Profile Details) state
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isUsernameAvailable, setIsUsernameAvailable] = useState<boolean | null>(
    null
  );
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [whatsappLink, setWhatsappLink] = useState('');
  const [instagramLink, setInstagramLink] = useState('');
  const [websiteLink, setWebsiteLink] = useState('');

  // Signup Step 2B (Password Setup) state
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  // Recovery state
  const [recoveryOtpSent, setRecoveryOtpSent] = useState(false);
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Status / Feedback state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const emailId = useId();
  const loginPasswordId = useId();
  const signupOtpId = useId();
  const usernameId = useId();
  const fullNameId = useId();
  const phoneId = useId();
  const bioId = useId();
  const whatsappId = useId();
  const instagramId = useId();
  const websiteId = useId();
  const signupPasswordId = useId();
  const signupConfirmPasswordId = useId();
  const recoveryOtpId = useId();
  const newPasswordId = useId();
  const confirmNewPasswordId = useId();

  // Auto-close welcome popup after 4 seconds if untouched
  useEffect(() => {
    if (!modalOpen || view !== 'welcome') return;
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [modalOpen, view, onClose]);

  // Debounced live uniqueness check on username in Step 2A
  useEffect(() => {
    if (view !== 'signup' || signupStep !== '2A') return;
    const cleaned = formatUsername(username);
    if (!cleaned || !USERNAME_REGEX.test(cleaned)) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('profiles')
          .select('id')
          .ilike('username', cleaned)
          .maybeSingle();

        if (cancelled) return;

        if (queryError) {
          setIsUsernameAvailable(true);
        } else if (data && data.id !== verifiedUserId) {
          setIsUsernameAvailable(false);
        } else {
          setIsUsernameAvailable(true);
        }
      } catch {
        if (!cancelled) {
          setIsUsernameAvailable(true);
        }
      } finally {
        if (!cancelled) {
          setIsCheckingUsername(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, view, signupStep, verifiedUserId]);

  if (!modalOpen) return null;

  const switchView = (nextView: AuthView) => {
    setView(nextView);
    setError(null);
    setInfoMessage(null);
    setVerificationToken('');
    if (nextView === 'signup') {
      setSignupStep('1');
      setSignupOtpSent(false);
      setSignupOtp('');
    }
    if (nextView === 'recovery') {
      setRecoveryStep(1);
      setRecoveryOtpSent(false);
      setRecoveryOtp('');
      setNewPassword('');
      setConfirmNewPassword('');
    }
  };

  // =========================================================================
  // MODE 1: LOGIN FLOW
  // =========================================================================
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Please enter a valid email address (e.g., name@domain.com).');
      return;
    }
    if (!loginPassword) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: loginPassword,
        });

      if (signInError) {
        throw signInError;
      }

      if (signInData.user) {
        await syncAuthenticatedProfileRole(
          signInData.user,
          signInData.session,
          true
        );
      }

      onClose();
    } catch (err) {
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // MODE 2: SIGNUP FLOW — STEP 1 (SERVER-SIDE RESEND OTP & STATELESS VERIFY)
  // =========================================================================
  const handleSendSignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Please enter a valid email address (e.g., name@domain.com).');
      return;
    }

    setLoading(true);
    try {
      const payload = await safeFetchJson<{
        success?: boolean;
        verificationToken?: string;
        error?: string;
      }>('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          mode: 'signup',
        }),
      });

      if (!payload?.success || !payload?.verificationToken) {
        throw new Error(
          payload?.error || 'Failed to send 6-digit verification code.'
        );
      }

      setVerificationToken(payload.verificationToken);
      setSignupOtpSent(true);
      setInfoMessage(
        `A 6-digit verification code has been sent to ${trimmedEmail}.`
      );
    } catch (err) {
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(signupOtp || '').trim();

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!OTP_REGEX.test(cleanOtp)) {
      setError('Please enter the 6-digit numeric verification code.');
      return;
    }

    setLoading(true);
    try {
      const payload = await safeFetchJson<{
        verified?: boolean;
        error?: string;
      }>('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          verificationToken,
        }),
      });

      if (!payload?.verified) {
        throw new Error(
          payload?.error || 'Verification code expired. Please click Resend Code.'
        );
      }

      if (!username) {
        const emailPrefix = formatUsername(cleanEmail.split('@')[0] || '');
        if (emailPrefix.length >= 3) {
          setUsername(emailPrefix);
          if (USERNAME_REGEX.test(emailPrefix)) {
            setIsCheckingUsername(true);
          }
        }
      }

      setSignupStep('2A');
      setInfoMessage('Email verified! Complete your profile details below.');
    } catch (err) {
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // MODE 2: SIGNUP FLOW — STEP 2A (PROFILE DETAILS)
  // =========================================================================
  const handleContinueToPasswordSetup = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanedUsername = formatUsername(username);
    const cleanedFullName = fullName.trim();
    const cleanedPhone = formatPhone(phone);

    if (!USERNAME_REGEX.test(cleanedUsername)) {
      setError(
        'Username must be 3–20 characters using only lowercase letters, numbers, and underscores.'
      );
      return;
    }
    if (isUsernameAvailable === false) {
      setError('That username is already taken. Please choose another.');
      return;
    }
    if (cleanedFullName.length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!PHONE_REGEX.test(cleanedPhone)) {
      setError(
        cleanedPhone.startsWith('+91')
          ? 'Please enter a valid 10-digit Indian mobile number starting with 6–9.'
          : 'Please enter a valid mobile number with country dial code.'
      );
      return;
    }

    setSignupStep('2B');
  };

  // =========================================================================
  // MODE 2: SIGNUP FLOW — STEP 2B (PASSWORD SETUP & IMMUNE FINALIZATION)
  // =========================================================================
  const handleCompleteSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const strength = getPasswordStrength(signupPassword);
    if (!strength.isValid) {
      setError(
        'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
      );
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      setError('Passwords do not match. Please verify both fields.');
      return;
    }

    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(signupOtp || '').trim();
    const cleanedUsername = formatUsername(username);
    const cleanedFullName = fullName.trim();
    const cleanedPhone = formatPhone(phone);

    const socialLinksPayload: Record<string, string> = {};
    if (whatsappLink.trim()) {
      socialLinksPayload.whatsapp = whatsappLink.trim();
    }
    if (instagramLink.trim()) {
      socialLinksPayload.instagram = instagramLink.trim();
    }
    if (websiteLink.trim()) {
      socialLinksPayload.website = websiteLink.trim();
    }

    setLoading(true);
    try {
      const payload = await safeFetchJson<{
        success?: boolean;
        userId?: string;
        role?: 'super_admin' | 'visitor';
        code?: string;
        error?: string;
      }>('/api/auth/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          verificationToken,
          password: signupPassword,
          username: cleanedUsername,
          full_name: cleanedFullName,
          phone: cleanedPhone,
          avatar_url: avatarUrl || null,
          bio: bio.trim() || null,
          social_links: socialLinksPayload,
        }),
      });

      if (!payload?.success) {
        throw new Error(
          payload?.error || 'Failed to complete account registration.'
        );
      }

      if (payload.userId) {
        setVerifiedUserId(payload.userId);
      }

      // Immediately sign in with the newly created confirmed credentials
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: signupPassword,
        });

      if (signInError) {
        throw signInError;
      }

      if (signInData.user) {
        await syncAuthenticatedProfileRole(
          signInData.user,
          signInData.session,
          true
        );
      } else {
        const assignedRole = payload.role || resolveInitialRole(cleanEmail);
        setAuthStoreState((prev) => ({
          ...prev,
          role: assignedRole,
          fullName: cleanedFullName,
          avatarUrl: avatarUrl ?? prev.avatarUrl,
          isLoading: false,
        }));
      }

      setError(null);
      setInfoMessage(null);
      setView('welcome');
    } catch (err) {
      const errObj = err as { code?: string; message?: string } | null;
      if (
        errObj?.code === '23505' ||
        String(errObj?.message || '')
          .toLowerCase()
          .includes('username')
      ) {
        setSignupStep('2A');
        setIsUsernameAvailable(false);
      }
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // MODE 3: FORGOT PASSWORD / RECOVERY FLOW (STATELESS OTP & RESET)
  // =========================================================================
  const handleSendRecoveryOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Please enter a valid email address (e.g., name@domain.com).');
      return;
    }

    setLoading(true);
    try {
      const payload = await safeFetchJson<{
        success?: boolean;
        verificationToken?: string;
        error?: string;
      }>('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          mode: 'recovery',
        }),
      });

      if (!payload?.success || !payload?.verificationToken) {
        throw new Error(
          payload?.error || 'Failed to send 6-digit recovery code.'
        );
      }

      setVerificationToken(payload.verificationToken);
      setRecoveryOtpSent(true);
      setInfoMessage(
        `A 6-digit recovery code has been sent to ${trimmedEmail}.`
      );
    } catch (err) {
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRecoveryOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(recoveryOtp || '').trim();

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!OTP_REGEX.test(cleanOtp)) {
      setError('Please enter the 6-digit recovery code.');
      return;
    }

    setLoading(true);
    try {
      const payload = await safeFetchJson<{
        verified?: boolean;
        error?: string;
      }>('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          verificationToken,
        }),
      });

      if (!payload?.verified) {
        throw new Error(
          payload?.error || 'Verification code expired. Please click Resend Code.'
        );
      }

      setRecoveryStep(2);
      setInfoMessage('Code verified! Please set your new password below.');
    } catch (err) {
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const strength = getPasswordStrength(newPassword);
    if (!strength.isValid) {
      setError(
        'New password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match. Please verify both fields.');
      return;
    }

    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(recoveryOtp || '').trim();

    setLoading(true);
    try {
      const payload = await safeFetchJson<{
        success?: boolean;
        error?: string;
      }>('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          verificationToken,
          newPassword,
        }),
      });

      if (!payload?.success) {
        throw new Error(
          payload?.error || 'Failed to reset password with recovery code.'
        );
      }

      try {
        await supabase.auth.signOut();
      } finally {
        setEmail(cleanEmail);
        setLoginPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setRecoveryOtp('');
        setRecoveryOtpSent(false);
        setVerificationToken('');
        setRecoveryStep(1);
        setView('login');
        setInfoMessage(
          'Password successfully reset. Please sign in with your new password.'
        );
      }
    } catch (err) {
      setError(mapSupabaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const signupPasswordChecks = getPasswordStrength(signupPassword);
  const recoveryPasswordChecks = getPasswordStrength(newPassword);
  const previewInitialRole = resolveInitialRole(email);

  return (
    <div
      className="fixed inset-0 z-[90] overscroll-none touch-none flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-y-auto overscroll-contain touch-pan-y shadow-none relative animate-in zoom-in-95 duration-200"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Sticky Elevated Opaque Header */}
        <div className="sticky top-0 z-30 bg-white dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800 px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <h2
              id="auth-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-white tracking-tight"
            >
              {view === 'login' && 'Welcome Back'}
              {view === 'signup' &&
                (signupStep === '1'
                  ? 'Create Account · Step 1 of 3'
                  : signupStep === '2A'
                    ? 'Complete Profile · Step 2 of 3'
                    : 'Set Password · Step 3 of 3')}
              {view === 'recovery' &&
                (recoveryStep === 1
                  ? 'Reset Password · Verify Email'
                  : 'Reset Password · New Password')}
              {view === 'welcome' && 'Account Verified'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {view === 'login' &&
                'Sign in with your email and password to continue'}
              {view === 'signup' &&
                signupStep === '1' &&
                'Verify your email address with a 6-digit code'}
              {view === 'signup' &&
                signupStep === '2A' &&
                'Set up your public username, contact details, and avatar'}
              {view === 'signup' &&
                signupStep === '2B' &&
                'Secure your account with a strong password'}
              {view === 'recovery' &&
                recoveryStep === 1 &&
                'Enter the 6-digit recovery code sent to your email'}
              {view === 'recovery' &&
                recoveryStep === 2 &&
                'Choose a new strong password for your account'}
              {view === 'welcome' &&
                'Your PrintSwift Local profile is ready'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div
          className="relative z-10 overflow-y-auto overscroll-contain touch-pan-y px-5 py-4 pb-8 space-y-4"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {error && (
            <div
              className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-red-600 dark:text-red-400 text-xs"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && !error && view !== 'welcome' && (
            <div
              className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2.5 text-emerald-700 dark:text-emerald-300 text-xs"
              role="status"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 4: WELCOME POPUP                                           */}
          {/* =============================================================== */}
          {view === 'welcome' && (
            <div
              data-testid="signup-welcome-popup"
              className="py-4 text-center space-y-4"
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 ring-8 ring-emerald-500/10 animate-bounce">
                <CheckCircle2 className="h-9 w-9" />
              </div>

              {avatarUrl && avatarUrl.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl.trim()}
                  alt={fullName.trim() || formatUsername(username)}
                  referrerPolicy="no-referrer"
                  className="mx-auto h-20 w-20 rounded-full object-cover border-2 border-emerald-500/40 shadow-md"
                />
              )}

              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  Welcome to PrintSwift Local, {fullName.trim() || formatUsername(username)}!
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Your account (@{formatUsername(username)}) is verified and you are now signed in.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                data-testid="welcome-start-exploring-btn"
                className="min-h-[44px] w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <span>Start Exploring</span>
              </button>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 1: LOGIN                                                   */}
          {/* =============================================================== */}
          {view === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
              <div className="relative">
                <input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder=" "
                  disabled={loading}
                  autoComplete="email"
                  className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
                <label
                  htmlFor={emailId}
                  className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                >
                  Email Address
                </label>
              </div>

              <PasswordInput
                id={loginPasswordId}
                label="Password"
                value={loginPassword}
                onChange={setLoginPassword}
                disabled={loading}
                autoComplete="current-password"
              />

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => switchView('recovery')}
                  disabled={loading}
                  className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline py-1"
                >
                  Forgot Password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 disabled:opacity-50 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </form>
          )}

          {/* =============================================================== */}
          {/* VIEW 2: SIGNUP — STEP 1 (EMAIL + 6-DIGIT OTP)                   */}
          {/* =============================================================== */}
          {view === 'signup' && signupStep === '1' && (
            <div className="space-y-4">
              <form
                onSubmit={
                  signupOtpSent ? handleVerifySignupOtp : handleSendSignupOtp
                }
                className="space-y-4"
                noValidate
              >
                <div className="relative">
                  <input
                    id={emailId}
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (signupOtpSent) {
                        setSignupOtpSent(false);
                        setSignupOtp('');
                        setVerificationToken('');
                      }
                    }}
                    placeholder=" "
                    disabled={loading}
                    autoComplete="email"
                    className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  />
                  <label
                    htmlFor={emailId}
                    className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                  >
                    Email Address
                  </label>
                </div>

                {signupOtpSent && (
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        id={signupOtpId}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={signupOtp}
                        onChange={(e) =>
                          setSignupOtp(formatOtp(e.target.value))
                        }
                        placeholder=" "
                        disabled={loading}
                        autoComplete="one-time-code"
                        className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-base font-mono tracking-[0.35em] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                      />
                      <label
                        htmlFor={signupOtpId}
                        className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                      >
                        6-Digit Verification Code
                      </label>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Didn&apos;t receive the code?</span>
                      <button
                        type="button"
                        onClick={handleSendSignupOtp}
                        disabled={loading}
                        className="font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        Resend Code
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 disabled:opacity-50 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {signupOtpSent
                          ? 'Verifying Code...'
                          : 'Sending Code...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      <span>
                        {signupOtpSent
                          ? 'Verify 6-Digit Code'
                          : 'Send Verification Code'}
                      </span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 2: SIGNUP — STEP 2A (PROFILE DETAILS)                      */}
          {/* =============================================================== */}
          {view === 'signup' && signupStep === '2A' && (
            <form
              onSubmit={handleContinueToPasswordSetup}
              className="space-y-4"
              noValidate
            >
              {/* Avatar Crop & Compression Uploader */}
              <div className="relative z-0 overflow-hidden p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Profile Photo (Optional · 1:1 Crop &amp; WebP)
                </p>
                <AvatarCropUploader
                  userId={verifiedUserId || 'signup'}
                  currentAvatarUrl={avatarUrl}
                  onUploadComplete={(url) => setAvatarUrl(url || null)}
                />
              </div>

              {/* Username with live uniqueness indicator & hint below input */}
              <div className="space-y-1.5">
                <div className="relative">
                  <input
                    id={usernameId}
                    type="text"
                    maxLength={20}
                    value={username}
                    onChange={(e) => {
                      const nextUsername = formatUsername(e.target.value);
                      setUsername(nextUsername);
                      if (
                        !nextUsername ||
                        !USERNAME_REGEX.test(nextUsername)
                      ) {
                        setIsUsernameAvailable(null);
                        setIsCheckingUsername(false);
                      } else {
                        setIsCheckingUsername(true);
                      }
                    }}
                    placeholder=" "
                    disabled={loading}
                    autoComplete="username"
                    className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  />
                  <label
                    htmlFor={usernameId}
                    className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                  >
                    USERNAME *
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1.5 px-1 text-[11px]">
                  <span className="text-slate-500 dark:text-slate-400">
                    3–20 characters, lowercase letters, numbers, or underscores (_)
                  </span>
                  {username.length > 0 && (
                    <>
                      {!USERNAME_REGEX.test(username) ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Must be 3–20 lowercase letters, numbers, or underscores.
                        </span>
                      ) : isCheckingUsername ? (
                        <span className="text-slate-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Checking availability...
                        </span>
                      ) : isUsernameAvailable === false ? (
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          @{username} is already taken.
                        </span>
                      ) : isUsernameAvailable === true ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          @{username} is available!
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {/* Full Name */}
              <div className="relative">
                <input
                  id={fullNameId}
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder=" "
                  disabled={loading}
                  autoComplete="name"
                  className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
                <label
                  htmlFor={fullNameId}
                  className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                >
                  Full Name *
                </label>
              </div>

              {/* Country Code + Mobile Number Input (defaults to +91 / timezone auto-detect) */}
              <PhoneCountryInput
                id={phoneId}
                value={phone}
                onChange={setPhone}
                disabled={loading}
                label="Mobile Number *"
              />

              {/* WhatsApp Number with Country Code Selector & "Use Mobile" Quick-Fill */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    WhatsApp Number (Optional)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (phone) {
                        setWhatsappLink(phone);
                      }
                    }}
                    disabled={loading || !phone}
                    data-testid="whatsapp-use-mobile-btn"
                    className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline disabled:opacity-40 disabled:no-underline transition-opacity"
                  >
                    Use Mobile
                  </button>
                </div>
                <PhoneCountryInput
                  id={whatsappId}
                  value={whatsappLink}
                  onChange={setWhatsappLink}
                  disabled={loading}
                  label="WhatsApp Number (Optional)"
                />
              </div>

              {/* Bio (Optional) */}
              <div className="relative">
                <textarea
                  id={bioId}
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder=" "
                  disabled={loading}
                  className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all resize-none"
                />
                <label
                  htmlFor={bioId}
                  className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                >
                  Short Bio (Optional)
                </label>
              </div>

              {/* Other Social Links (Optional) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="relative">
                  <input
                    id={instagramId}
                    type="text"
                    value={instagramLink}
                    onChange={(e) => setInstagramLink(e.target.value)}
                    placeholder=" "
                    disabled={loading}
                    className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-3 pt-5 pb-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  />
                  <label
                    htmlFor={instagramId}
                    className="absolute left-3 top-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 pointer-events-none"
                  >
                    Instagram
                  </label>
                </div>
                <div className="relative">
                  <input
                    id={websiteId}
                    type="url"
                    value={websiteLink}
                    onChange={(e) => setWebsiteLink(e.target.value)}
                    placeholder=" "
                    disabled={loading}
                    className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-3 pt-5 pb-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  />
                  <label
                    htmlFor={websiteId}
                    className="absolute left-3 top-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 pointer-events-none"
                  >
                    Website
                  </label>
                </div>
              </div>

              {/* Locked Role Governance Badge */}
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {previewInitialRole === 'super_admin' ? (
                    <ShieldCheck className="w-4 h-4 text-sky-500 shrink-0" />
                  ) : (
                    <UserCheck className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      Assigned Platform Role:{' '}
                      <span className="uppercase tracking-wider text-sky-600 dark:text-sky-400">
                        {previewInitialRole}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {previewInitialRole === 'super_admin'
                        ? 'Recognized as authorized Super-Admin account.'
                        : 'New signups start as Visitor. Owner/Staff roles are granted by Super-Admins.'}
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || isCheckingUsername}
                className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 disabled:opacity-50 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <span>Continue to Password Setup</span>
              </button>
            </form>
          )}

          {/* =============================================================== */}
          {/* VIEW 2: SIGNUP — STEP 2B (PASSWORD SETUP & FINALIZATION)        */}
          {/* =============================================================== */}
          {view === 'signup' && signupStep === '2B' && (
            <form
              onSubmit={handleCompleteSignup}
              className="space-y-4"
              noValidate
            >
              <button
                type="button"
                onClick={() => setSignupStep('2A')}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Profile Details
              </button>

              <PasswordInput
                id={signupPasswordId}
                label="Create Password"
                value={signupPassword}
                onChange={setSignupPassword}
                disabled={loading}
                autoComplete="new-password"
              />

              <PasswordInput
                id={signupConfirmPasswordId}
                label="Confirm Password"
                value={signupConfirmPassword}
                onChange={setSignupConfirmPassword}
                disabled={loading}
                autoComplete="new-password"
              />

              {/* Live Password Strength Checklist */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Password Requirements
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
                  <li
                    className={
                      signupPasswordChecks.minLength
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 8+ characters
                  </li>
                  <li
                    className={
                      signupPasswordChecks.hasUpper
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 1 uppercase letter (A–Z)
                  </li>
                  <li
                    className={
                      signupPasswordChecks.hasLower
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 1 lowercase letter (a–z)
                  </li>
                  <li
                    className={
                      signupPasswordChecks.hasNumber
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 1 number (0–9)
                  </li>
                  <li
                    className={
                      signupPasswordChecks.hasSpecial
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold sm:col-span-2'
                        : 'text-slate-500 sm:col-span-2'
                    }
                  >
                    • 1 special character (@$!%*?&amp;.#^_-)
                  </li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 disabled:opacity-50 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Finalizing Account...</span>
                  </>
                ) : (
                  <span>Complete Registration</span>
                )}
              </button>
            </form>
          )}

          {/* =============================================================== */}
          {/* VIEW 3: FORGOT PASSWORD / RECOVERY                              */}
          {/* =============================================================== */}
          {view === 'recovery' && recoveryStep === 1 && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => switchView('login')}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
              </button>

              <form
                onSubmit={
                  recoveryOtpSent
                    ? handleVerifyRecoveryOtp
                    : handleSendRecoveryOtp
                }
                className="space-y-4"
                noValidate
              >
                <div className="relative">
                  <input
                    id={emailId}
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (recoveryOtpSent) {
                        setRecoveryOtpSent(false);
                        setRecoveryOtp('');
                        setVerificationToken('');
                      }
                    }}
                    placeholder=" "
                    disabled={loading}
                    autoComplete="email"
                    className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  />
                  <label
                    htmlFor={emailId}
                    className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                  >
                    Registered Email Address
                  </label>
                </div>

                {recoveryOtpSent && (
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        id={recoveryOtpId}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={recoveryOtp}
                        onChange={(e) =>
                          setRecoveryOtp(formatOtp(e.target.value))
                        }
                        placeholder=" "
                        disabled={loading}
                        autoComplete="one-time-code"
                        className="peer w-full bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-base font-mono tracking-[0.35em] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                      />
                      <label
                        htmlFor={recoveryOtpId}
                        className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none"
                      >
                        6-Digit Recovery Code
                      </label>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Didn&apos;t receive the recovery code?</span>
                      <button
                        type="button"
                        onClick={handleSendRecoveryOtp}
                        disabled={loading}
                        className="font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        Resend Code
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 disabled:opacity-50 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {recoveryOtpSent
                          ? 'Verifying Recovery Code...'
                          : 'Sending Recovery Code...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {recoveryOtpSent
                          ? 'Verify Recovery Code'
                          : 'Send 6-Digit Recovery Code'}
                      </span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {view === 'recovery' && recoveryStep === 2 && (
            <form
              onSubmit={handleResetPasswordSubmit}
              className="space-y-4"
              noValidate
            >
              <PasswordInput
                id={newPasswordId}
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                disabled={loading}
                autoComplete="new-password"
              />

              <PasswordInput
                id={confirmNewPasswordId}
                label="Confirm New Password"
                value={confirmNewPassword}
                onChange={setConfirmNewPassword}
                disabled={loading}
                autoComplete="new-password"
              />

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Password Requirements
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
                  <li
                    className={
                      recoveryPasswordChecks.minLength
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 8+ characters
                  </li>
                  <li
                    className={
                      recoveryPasswordChecks.hasUpper
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 1 uppercase letter (A–Z)
                  </li>
                  <li
                    className={
                      recoveryPasswordChecks.hasLower
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 1 lowercase letter (a–z)
                  </li>
                  <li
                    className={
                      recoveryPasswordChecks.hasNumber
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500'
                    }
                  >
                    • 1 number (0–9)
                  </li>
                  <li
                    className={
                      recoveryPasswordChecks.hasSpecial
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold sm:col-span-2'
                        : 'text-slate-500 sm:col-span-2'
                    }
                  >
                    • 1 special character (@$!%*?&amp;.#^_-)
                  </li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 disabled:opacity-50 text-white dark:text-slate-900 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <span>Update Password &amp; Sign In</span>
                )}
              </button>
            </form>
          )}

          {/* Footer Switcher */}
          {view !== 'welcome' && (
            <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800 text-center">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {view === 'login' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchView('signup')}
                      disabled={loading}
                      className="text-slate-900 dark:text-white font-bold hover:underline ml-1"
                    >
                      Create Account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchView('login')}
                      disabled={loading}
                      className="text-slate-900 dark:text-white font-bold hover:underline ml-1"
                    >
                      Sign In
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
