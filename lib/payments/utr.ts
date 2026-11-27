/**
 * Shared canonical UPI UTR normalization & validation rules (v21b P1-15).
 * Single source of truth across Pick N Drop, Order Tracker, Universal Payment,
 * Pay-Per Checkout, and `/api/payments/submit-utr`.
 */

export const UTR_MIN_LENGTH = 8;
export const UTR_MAX_LENGTH = 32;
export const UTR_REGEX = /^[A-Z0-9]{8,32}$/;
export const UTR_FORMAT_HINT =
  'Enter 8 to 32 letters/numbers from your UPI transaction / UTR reference.';

export function normalizeUtr(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function isValidUtr(raw: string | null | undefined): boolean {
  const normalized = normalizeUtr(raw);
  return UTR_REGEX.test(normalized);
}
