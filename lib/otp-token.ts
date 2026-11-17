import { createHmac, timingSafeEqual } from 'crypto';

function getOtpSecret(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'printswift-local-otp-secret'
  );
}

interface SignedOtpPayload {
  email: string;
  otp: string;
  exp: number;
}

export function createSignedOtpToken(
  email: string,
  otp: string,
  ttlMs = 15 * 60 * 1000
): string {
  const cleanEmail = String(email || '')
    .trim()
    .toLowerCase();
  const cleanOtp = String(otp || '').trim();
  const exp = Date.now() + ttlMs;

  const payloadJson = JSON.stringify({
    email: cleanEmail,
    otp: cleanOtp,
    exp,
  } satisfies SignedOtpPayload);

  const payloadBase64Url = Buffer.from(payloadJson, 'utf8').toString(
    'base64url'
  );
  const signatureHex = createHmac('sha256', getOtpSecret())
    .update(payloadBase64Url)
    .digest('hex');

  return `${payloadBase64Url}.${signatureHex}`;
}

export function verifySignedOtpToken(
  token: string,
  email: string,
  otp: string
): { valid: boolean; reason?: string } {
  const rawToken = String(token || '').trim();
  const cleanEmail = String(email || '')
    .trim()
    .toLowerCase();
  const cleanOtp = String(otp || '').trim();

  if (!rawToken || !rawToken.includes('.')) {
    return {
      valid: false,
      reason: 'Verification code expired. Please click Resend Code.',
    };
  }

  const [payloadBase64Url, providedSignatureHex] = rawToken.split('.');
  if (!payloadBase64Url || !providedSignatureHex) {
    return {
      valid: false,
      reason: 'Verification code expired. Please click Resend Code.',
    };
  }

  const expectedSignatureHex = createHmac('sha256', getOtpSecret())
    .update(payloadBase64Url)
    .digest('hex');

  const providedBuffer = Buffer.from(providedSignatureHex, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignatureHex, 'utf8');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return {
      valid: false,
      reason: 'Verification code expired. Please click Resend Code.',
    };
  }

  let payload: SignedOtpPayload;
  try {
    const decoded = Buffer.from(payloadBase64Url, 'base64url').toString('utf8');
    payload = JSON.parse(decoded) as SignedOtpPayload;
  } catch {
    return {
      valid: false,
      reason: 'Verification code expired. Please click Resend Code.',
    };
  }

  if (!payload || payload.email !== cleanEmail) {
    return {
      valid: false,
      reason: 'Verification code expired. Please click Resend Code.',
    };
  }

  if (
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    Date.now() >= payload.exp
  ) {
    return {
      valid: false,
      reason: 'Verification code expired. Please click Resend Code.',
    };
  }

  if (payload.otp !== cleanOtp) {
    return {
      valid: false,
      reason: 'Incorrect 6-digit code. Please check your email and try again.',
    };
  }

  return { valid: true };
}
