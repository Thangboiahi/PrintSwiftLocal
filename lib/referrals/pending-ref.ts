/**
 * Pending Referral Code Storage Helper (Pass V6-B)
 *
 * Captures `?ref=CODE` from inbound links into `localStorage` under
 * `dd_pending_ref_code` with a strict 14-day TTL so signups or profile
 * visits can automatically prefill and apply the referrer code.
 */

export const PENDING_REF_STORAGE_KEY = 'dd_pending_ref_code';
const REF_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const REF_CODE_REGEX = /^[A-Z0-9_-]{4,24}$/;

interface StoredPendingRef {
  code: string;
  capturedAt: number;
  expiresAt: number;
}

export function normalizeReferralCode(raw: string | null | undefined): string {
  const cleaned = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!REF_CODE_REGEX.test(cleaned)) {
    return '';
  }
  return cleaned;
}

export function savePendingReferralCode(rawCode: string): string | null {
  if (typeof window === 'undefined') return null;
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;

  const now = Date.now();
  const payload: StoredPendingRef = {
    code,
    capturedAt: now,
    expiresAt: now + REF_TTL_MS,
  };
  try {
    window.localStorage.setItem(
      PENDING_REF_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore private-mode / quota errors
  }
  return code;
}

export function readPendingReferralCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_REF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPendingRef>;
    const code = normalizeReferralCode(parsed?.code);
    if (!code) {
      window.localStorage.removeItem(PENDING_REF_STORAGE_KEY);
      return null;
    }
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(PENDING_REF_STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearPendingReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_REF_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function capturePendingReferralCodeFromSearch(
  search: string
): string | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    const refParam = params.get('ref');
    if (!refParam) return null;
    return savePendingReferralCode(refParam);
  } catch {
    return null;
  }
}
