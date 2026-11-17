export const SUPER_ADMIN_EMAILS = [
  'thangboiahi@gmail.com',
  'homeautomation.dd@gmail.com',
] as const;

export function resolveInitialRole(
  email?: string | null
): 'super_admin' | 'visitor' {
  if (!email) return 'visitor';
  const normalized = email.trim().toLowerCase();
  return (SUPER_ADMIN_EMAILS as readonly string[]).includes(normalized)
    ? 'super_admin'
    : 'visitor';
}

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const OTP_REGEX = /^\d{6}$/;
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#^_-])[A-Za-z\d@$!%*?&.#^_-]{8,}$/;
export const INDIA_PHONE_REGEX = /^\+91[6-9]\d{9}$/;
export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
export const PHONE_REGEX =
  /^(?:\+91[6-9]\d{9}|\+(?!91)[1-9]\d{6,14}|[6-9]\d{9})$/;
export const SOCIAL_REGEX =
  /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w-./?%&=]*)?$|^@[a-zA-Z0-9._]{1,30}$/;

export function isValidPhone(val: string): boolean {
  const cleaned = formatPhone(val);
  if (cleaned.startsWith('+91')) {
    return INDIA_PHONE_REGEX.test(cleaned);
  }
  if (cleaned.startsWith('+')) {
    return E164_PHONE_REGEX.test(cleaned);
  }
  return /^[6-9]\d{9}$/.test(cleaned);
}

export function formatUsername(val: string): string {
  return (val || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
}

export function formatOtp(val: string): string {
  return (val || '').replace(/\D/g, '').slice(0, 6);
}

export function formatPhone(val: string): string {
  const raw = (val || '').trim();
  if (raw.startsWith('+')) {
    return '+' + raw.slice(1).replace(/\D/g, '').slice(0, 15);
  }
  return raw.replace(/\D/g, '').slice(0, 15);
}

export interface PasswordStrengthResult {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  isValid: boolean;
}

export function getPasswordStrength(val: string): PasswordStrengthResult {
  const value = val || '';
  const minLength = value.length >= 8;
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSpecial = /[@$!%*?&.#^_-]/.test(value);
  const isValid =
    minLength &&
    hasUpper &&
    hasLower &&
    hasNumber &&
    hasSpecial &&
    PASSWORD_REGEX.test(value);

  return {
    minLength,
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
    isValid,
  };
}

export function mapSupabaseAuthError(err: unknown): string {
  if (!err) {
    return 'An unexpected authentication error occurred. Please try again.';
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Please check your internet connection and try again.';
  }

  const errObj =
    typeof err === 'object' && err !== null
      ? (err as {
          code?: string;
          status?: number;
          message?: string;
          error_description?: string;
          details?: string;
        })
      : { message: String(err) };

  const code = String(errObj.code || '').toLowerCase();
  const rawMessage = String(
    errObj.message || errObj.error_description || errObj.details || ''
  );
  const lowerMessage = rawMessage.toLowerCase();

  if (
    rawMessage ===
      'Incorrect 6-digit code. Please check your email and try again.' ||
    rawMessage === 'Verification code expired. Please click Resend Code.' ||
    rawMessage ===
      'An account with this email already exists. Please Sign In instead.' ||
    rawMessage ===
      'An incomplete auth record exists for this email. Please delete it in Supabase Auth > Users or use Forgot Password.'
  ) {
    return rawMessage;
  }

  if (
    code === 'email_not_confirmed' ||
    lowerMessage.includes('email not confirmed')
  ) {
    return 'Your email is not confirmed yet. Please disable "Confirm email" in Supabase Auth settings or verify via OTP.';
  }

  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    lowerMessage.includes('user already registered') ||
    lowerMessage.includes('already been registered') ||
    lowerMessage.includes('already registered')
  ) {
    return 'An account with this email already exists. Please switch to Sign In or use Forgot Password.';
  }

  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_sms_send_rate_limit' ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    errObj.status === 429
  ) {
    return 'Too many verification requests sent recently. Please wait a minute before trying again.';
  }

  if (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    lowerMessage.includes('otp_expired') ||
    lowerMessage.includes('token has expired or is invalid') ||
    lowerMessage.includes('expired')
  ) {
    return 'Verification code expired. Please click Resend Code.';
  }

  if (
    code === 'invalid_credentials' ||
    code === 'invalid_grant' ||
    lowerMessage.includes('invalid login credentials') ||
    lowerMessage.includes('invalid credentials')
  ) {
    return 'Incorrect email or password. Please double-check your password and try again.';
  }

  if (
    code === 'same_password' ||
    lowerMessage.includes('same_password') ||
    lowerMessage.includes('different from the old password')
  ) {
    return 'Your new password must be different from your current password.';
  }

  if (
    code === '23505' ||
    code === 'phone_exists' ||
    lowerMessage.includes('duplicate key') ||
    lowerMessage.includes('unique constraint')
  ) {
    if (lowerMessage.includes('username')) {
      return 'That username is already taken. Please choose another username.';
    }
    if (lowerMessage.includes('phone')) {
      return 'An account with this phone number already exists.';
    }
    if (lowerMessage.includes('email')) {
      return 'An account with this email already exists. Please switch to Sign In or use Forgot Password.';
    }
    return 'This account or username is already registered. Please sign in or use different details.';
  }

  if (
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('networkerror') ||
    lowerMessage.includes('network request failed') ||
    lowerMessage.includes('load failed')
  ) {
    return 'Network connection error. Please check your internet connection and try again.';
  }

  if (lowerMessage.includes('unauthorized: only authorized administrators')) {
    return 'Unauthorized: Only authorized administrators can modify user roles.';
  }

  return rawMessage || 'Authentication failed. Please try again.';
}

export async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);
  const text = await res.text();
  const trimmed = text.trim();

  if (
    !trimmed ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.toLowerCase().startsWith('<html')
  ) {
    throw new Error(
      `Server error (${res.status}): Please check API route or environment keys.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Server error (${res.status}): Please check API route or environment keys.`
    );
  }

  if (!res.ok) {
    const errPayload = parsed as {
      error?: string;
      message?: string;
      code?: string;
    } | null;
    const errMsg =
      errPayload?.error ||
      errPayload?.message ||
      `Server error (${res.status}): Please check API route or environment keys.`;
    const errorToThrow = new Error(errMsg) as Error & {
      code?: string;
      status?: number;
    };
    if (errPayload?.code) {
      errorToThrow.code = errPayload.code;
    }
    errorToThrow.status = res.status;
    throw errorToThrow;
  }

  return parsed as T;
}
