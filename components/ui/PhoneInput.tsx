'use client';

import React from 'react';
import {
  COUNTRY_DIAL_OPTIONS,
  PhoneInputWithCountry,
  isValidCountryPhone,
  parsePhoneWithCountry,
  type CountryDialOption,
  type PhoneInputWithCountryProps,
} from '@/components/ui/PhoneInputWithCountry';

export {
  COUNTRY_DIAL_OPTIONS,
  PhoneInputWithCountry,
  isValidCountryPhone,
  parsePhoneWithCountry,
};
export type { CountryDialOption };

export interface PhoneInputProps extends PhoneInputWithCountryProps {
  label?: string;
  helperText?: string;
}

/**
 * Normalizes a raw phone string into E.164 format, defaulting to +91 (India)
 * when no explicit country dial prefix is present.
 */
export function normalizePhoneToE164(
  raw?: string | null,
  defaultDialCode = '+91'
): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `${defaultDialCode}${digits}`;
  }
  if (digits.length > 10 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  return `${defaultDialCode}${digits}`;
}

/**
 * Standardized E.164 phone input across Admin, Superadmin, and partner consoles.
 * Defaults to India (+91) with searchable country picker and 44px touch target.
 */
export function PhoneInput({
  label,
  helperText,
  className = '',
  ...rest
}: PhoneInputProps) {
  return (
    <div className={`w-full space-y-1 ${className}`}>
      {label && (
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
          {label}
          {rest.required ? ' *' : ''}
        </label>
      )}
      <PhoneInputWithCountry {...rest} />
      {helperText && (
        <p className="text-[11px] text-[var(--ps-text-muted)]">{helperText}</p>
      )}
    </div>
  );
}

export default PhoneInput;
