'use client';

import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import CustomSelectModal from '@/components/ui/CustomSelectModal';

export interface CountryDialOption {
  code: string;
  iso: string;
  label: string;
  flag: string;
  digits: number;
  minDigits?: number;
  placeholder: string;
}

export const COUNTRY_DIAL_OPTIONS: CountryDialOption[] = [
  { code: '+91', iso: 'IN', label: 'India (+91)', flag: '🇮🇳', digits: 10, minDigits: 10, placeholder: '98620 00000' },
  { code: '+95', iso: 'MM', label: 'Myanmar (+95)', flag: '🇲🇲', digits: 10, minDigits: 8, placeholder: '09 123 4567' },
  { code: '+880', iso: 'BD', label: 'Bangladesh (+880)', flag: '🇧🇩', digits: 10, minDigits: 10, placeholder: '1712 345678' },
  { code: '+977', iso: 'NP', label: 'Nepal (+977)', flag: '🇳🇵', digits: 10, minDigits: 10, placeholder: '9841 234567' },
  { code: '+975', iso: 'BT', label: 'Bhutan (+975)', flag: '🇧🇹', digits: 8, minDigits: 8, placeholder: '17 123 456' },
  { code: '+1', iso: 'US', label: 'US / Canada (+1)', flag: '🇺🇸', digits: 10, minDigits: 10, placeholder: '555 123 4567' },
  { code: '+44', iso: 'GB', label: 'United Kingdom (+44)', flag: '🇬🇧', digits: 10, minDigits: 10, placeholder: '7700 900123' },
  { code: '+971', iso: 'AE', label: 'UAE (+971)', flag: '🇦🇪', digits: 9, minDigits: 9, placeholder: '50 123 4567' },
  { code: '+65', iso: 'SG', label: 'Singapore (+65)', flag: '🇸🇬', digits: 8, minDigits: 8, placeholder: '8123 4567' },
  { code: '+61', iso: 'AU', label: 'Australia (+61)', flag: '🇦🇺', digits: 9, minDigits: 9, placeholder: '412 345 678' },
  { code: '+49', iso: 'DE', label: 'Germany (+49)', flag: '🇩🇪', digits: 11, minDigits: 10, placeholder: '1512 3456789' },
];

export interface ParsedPhoneValue {
  dialCode: string;
  localDigits: string;
  country: CountryDialOption;
}

/**
 * Parses an incoming phone value (E.164 like "+919862011223", spaced "+91 98620 11223",
 * or local digits "9862011223") into `{ dialCode, localDigits, country }`.
 */
export function parsePhoneWithCountry(rawValue: string | null | undefined): ParsedPhoneValue {
  const defaultCountry = COUNTRY_DIAL_OPTIONS[0];
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return {
      dialCode: defaultCountry.code,
      localDigits: '',
      country: defaultCountry,
    };
  }

  // Sort by dial code length descending so +880/+977/+975/+971 match before +1/+91
  const sorted = [...COUNTRY_DIAL_OPTIONS].sort((a, b) => b.code.length - a.code.length);

  if (trimmed.startsWith('+')) {
    for (const c of sorted) {
      if (trimmed.startsWith(c.code)) {
        const rest = trimmed
          .slice(c.code.length)
          .replace(/\D/g, '')
          .slice(0, c.digits);
        return {
          dialCode: c.code,
          localDigits: rest,
          country: c,
        };
      }
    }
  }

  // Handle 12-digit 91XXXXXXXXXX without leading '+'
  const onlyDigits = trimmed.replace(/\D/g, '');
  if (onlyDigits.length === 12 && onlyDigits.startsWith('91')) {
    return {
      dialCode: '+91',
      localDigits: onlyDigits.slice(2, 12),
      country: defaultCountry,
    };
  }

  return {
    dialCode: defaultCountry.code,
    localDigits: onlyDigits.slice(0, defaultCountry.digits),
    country: defaultCountry,
  };
}

/**
 * Validates whether a phone string is empty (when optional) or satisfies the active country length
 * (or short emergency helpline digits when `allowShortCode` is enabled).
 */
export function isValidCountryPhone(
  rawValue: string | null | undefined,
  options?: { required?: boolean; allowShortCode?: boolean }
): boolean {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return !options?.required;

  if (options?.allowShortCode) {
    const rawDigits = trimmed.replace(/\D/g, '');
    if (rawDigits.length >= 3 && rawDigits.length <= 6 && !trimmed.startsWith('+')) {
      return true;
    }
  }

  const { localDigits, country } = parsePhoneWithCountry(trimmed);
  const min = country.minDigits ?? country.digits;
  return localDigits.length >= min && localDigits.length <= country.digits;
}

export interface PhoneInputWithCountryProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (fullPhone: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  helperText?: string;
  testId?: string;
  placeholder?: string;
  /** Compact, standard, or floating-label layout */
  variant?: 'default' | 'sm' | 'floating';
  /** Optional "Same as phone" toggle for WhatsApp fields */
  sameAsPhoneChecked?: boolean;
  onSameAsPhoneChange?: (checked: boolean) => void;
  sameAsPhoneLabel?: string;
  /** Source phone number to sync when "Same as phone" is checked */
  sourcePhoneValue?: string;
  /** Allow 3-6 digit civic emergency shortcodes (e.g. 100, 101, 108, 112) */
  allowShortCode?: boolean;
  className?: string;
}

/**
 * Unified DD oodle Country Code + Phone Input Component.
 * Uses `<CustomSelectModal />` (portaled at z-[98]) for the country dial selector,
 * strips non-digit characters automatically, enforces country digit limits, and
 * emits normalized E.164 (`+919862000000`) or empty string when cleared.
 */
export function PhoneInputWithCountry({
  id,
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  error,
  helperText,
  testId = 'phone-country-input',
  placeholder,
  variant = 'default',
  sameAsPhoneChecked,
  onSameAsPhoneChange,
  sameAsPhoneLabel = 'Same as phone',
  sourcePhoneValue,
  allowShortCode = false,
  className = '',
}: PhoneInputWithCountryProps) {
  const effectiveValue =
    sameAsPhoneChecked && sourcePhoneValue !== undefined ? sourcePhoneValue : value;

  const parsed = useMemo(() => parsePhoneWithCountry(effectiveValue), [effectiveValue]);
  const [selectedCode, setSelectedCode] = useState<string>(parsed.dialCode);

  // Keep selectedCode in sync if incoming value explicitly carries a dial prefix
  const activeCode = effectiveValue.trim().startsWith('+') ? parsed.dialCode : selectedCode;
  const activeCountry =
    COUNTRY_DIAL_OPTIONS.find((c) => c.code === activeCode) || COUNTRY_DIAL_OPTIONS[0];

  const isShortCodeMode =
    allowShortCode &&
    !effectiveValue.trim().startsWith('+') &&
    effectiveValue.replace(/\D/g, '').length > 0 &&
    effectiveValue.replace(/\D/g, '').length <= 6;

  const displayDigits = isShortCodeMode
    ? effectiveValue.replace(/\D/g, '').slice(0, 6)
    : effectiveValue.trim().startsWith('+')
      ? parsed.localDigits
      : effectiveValue.replace(/\D/g, '').slice(0, activeCountry.digits);

  const handleCountryChange = (newCode: string) => {
    setSelectedCode(newCode);
    const nextCountry =
      COUNTRY_DIAL_OPTIONS.find((c) => c.code === newCode) || COUNTRY_DIAL_OPTIONS[0];
    const trimmedDigits = displayDigits.slice(0, nextCountry.digits);
    onChange(trimmedDigits ? `${newCode}${trimmedDigits}` : '');
  };

  const handleDigitsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly) {
      onChange('');
      return;
    }
    if (allowShortCode && digitsOnly.length <= 5 && !raw.startsWith('+')) {
      onChange(digitsOnly);
      return;
    }
    const capped = digitsOnly.slice(0, activeCountry.digits);
    onChange(`${activeCountry.code}${capped}`);
  };

  const selectOptions = useMemo(
    () =>
      COUNTRY_DIAL_OPTIONS.map((c) => ({
        value: c.code,
        label: `${c.flag} ${c.code} · ${c.label.replace(/\s*\(\+\d+\)/, '')}`,
      })),
    []
  );

  const heightClass =
    variant === 'floating'
      ? 'h-[58px]'
      : variant === 'sm'
        ? 'h-9'
        : 'h-10';

  return (
    <div className={`w-full ${className}`} data-testid={testId}>
      {(label || onSameAsPhoneChange) && variant !== 'floating' && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label ? (
            <label
              htmlFor={id}
              className="block text-xs font-bold text-[var(--text-primary,var(--ps-text))]"
            >
              {label} {required && <span className="text-rose-500">*</span>}
            </label>
          ) : (
            <span />
          )}

          {onSameAsPhoneChange && (
            <button
              type="button"
              onClick={() => {
                const next = !sameAsPhoneChecked;
                onSameAsPhoneChange(next);
                if (next && sourcePhoneValue !== undefined) {
                  onChange(sourcePhoneValue);
                }
              }}
              data-testid={`${testId}-same-as-phone`}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-bold transition-colors ${
                sameAsPhoneChecked
                  ? 'bg-[var(--brand-primary,var(--ps-accent))]/15 text-[var(--brand-primary,var(--ps-accent))]'
                  : 'text-[var(--text-muted,var(--ps-text-muted))] hover:text-[var(--text-primary,var(--ps-text))]'
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                  sameAsPhoneChecked
                    ? 'border-[var(--brand-primary,var(--ps-accent))] bg-[var(--brand-primary,var(--ps-accent))] text-white'
                    : 'border-[var(--border-subtle,var(--ps-border))] bg-transparent'
                }`}
              >
                {sameAsPhoneChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
              </span>
              <span>{sameAsPhoneLabel}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex items-stretch gap-2">
        {/* Country Dial Code Trigger via CustomSelectModal */}
        <div className={variant === 'floating' ? 'w-[116px] shrink-0' : 'w-[104px] shrink-0'}>
          <CustomSelectModal
            value={activeCountry.code}
            onChange={handleCountryChange}
            options={selectOptions}
            placeholder="+91"
            disabled={disabled || Boolean(sameAsPhoneChecked)}
            testId={`${testId}-country`}
            className={`${heightClass} !rounded-xl !px-2.5 !py-0 border ${
              error
                ? '!border-rose-500/80'
                : '!border-[var(--border-subtle,var(--ps-border))]'
            } !bg-[var(--bg-surface,var(--ps-surface))] text-xs font-bold`}
          />
        </div>

        {/* Local Digits Input */}
        <div className="relative flex-1 min-w-0">
          <input
            id={id}
            type="tel"
            inputMode="numeric"
            required={required}
            disabled={disabled || Boolean(sameAsPhoneChecked)}
            value={displayDigits}
            onChange={handleDigitsChange}
            placeholder={
              variant === 'floating'
                ? ' '
                : placeholder || activeCountry.placeholder
            }
            maxLength={activeCountry.digits}
            data-testid={`${testId}-digits`}
            className={
              variant === 'floating'
                ? `peer w-full ${heightClass} px-4 pt-5 pb-1.5 rounded-xl bg-[var(--bg-surface,var(--ps-surface))] border ${
                    error
                      ? 'border-rose-500/80 focus:border-rose-500'
                      : 'border-[var(--border-subtle,var(--ps-border))] focus:border-[var(--brand-primary,var(--ps-accent))]'
                  } text-[var(--text-primary,var(--ps-text))] text-[15px] font-medium outline-none transition-all duration-200 focus:ring-2 focus:ring-[var(--brand-primary,var(--ps-accent))]/20 disabled:opacity-60`
                : `w-full ${heightClass} rounded-xl border ${
                    error
                      ? 'border-rose-500/80 focus:border-rose-500'
                      : 'border-[var(--border-subtle,var(--ps-border))] focus:border-[var(--brand-primary,var(--ps-accent))]'
                  } bg-[var(--bg-surface,var(--ps-surface))] px-3 pr-12 text-xs font-medium text-[var(--text-primary,var(--ps-text))] placeholder:text-[var(--text-muted,var(--ps-text-muted))] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary,var(--ps-accent))]/20 disabled:opacity-60`
            }
          />
          {variant === 'floating' && label && (
            <label
              htmlFor={id}
              className="absolute left-4 top-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary,var(--ps-text-muted))] transition-all duration-200 pointer-events-none peer-placeholder-shown:top-[19px] peer-placeholder-shown:text-[14px] peer-placeholder-shown:font-medium peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wider peer-focus:text-[var(--brand-primary,var(--ps-accent))]"
            >
              {label} ({activeCountry.digits} digits)
            </label>
          )}
          {variant !== 'floating' && displayDigits.length > 0 && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[var(--text-muted,var(--ps-text-muted))]">
              {displayDigits.length}/{activeCountry.digits}
            </span>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-1 text-[11px] font-medium text-rose-500">{error}</p>
      ) : helperText ? (
        <p className="mt-1 text-[10px] text-[var(--text-muted,var(--ps-text-muted))]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export default PhoneInputWithCountry;
