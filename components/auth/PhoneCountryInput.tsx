'use client';

import React, { useState, useId } from 'react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';

export interface CountryDialOption {
  code: string;
  country: string;
  flag: string;
  maxDigits: number;
  placeholder: string;
}

export const COUNTRY_DIAL_OPTIONS: readonly CountryDialOption[] = [
  {
    code: '+91',
    country: 'India',
    flag: '🇮🇳',
    maxDigits: 10,
    placeholder: '9862011223',
  },
  {
    code: '+1',
    country: 'US / Canada',
    flag: '🇺🇸',
    maxDigits: 10,
    placeholder: '4155550199',
  },
  {
    code: '+44',
    country: 'United Kingdom',
    flag: '🇬🇧',
    maxDigits: 10,
    placeholder: '7700900077',
  },
  {
    code: '+971',
    country: 'UAE',
    flag: '🇦🇪',
    maxDigits: 9,
    placeholder: '501234567',
  },
  {
    code: '+65',
    country: 'Singapore',
    flag: '🇸🇬',
    maxDigits: 8,
    placeholder: '81234567',
  },
  {
    code: '+95',
    country: 'Myanmar',
    flag: '🇲🇲',
    maxDigits: 10,
    placeholder: '912345678',
  },
  {
    code: '+880',
    country: 'Bangladesh',
    flag: '🇧🇩',
    maxDigits: 10,
    placeholder: '1712345678',
  },
  {
    code: '+977',
    country: 'Nepal',
    flag: '🇳🇵',
    maxDigits: 10,
    placeholder: '9841234567',
  },
  {
    code: '+61',
    country: 'Australia',
    flag: '🇦🇺',
    maxDigits: 9,
    placeholder: '412345678',
  },
  {
    code: '+49',
    country: 'Germany',
    flag: '🇩🇪',
    maxDigits: 11,
    placeholder: '15123456789',
  },
] as const;

function detectDialCodeFromTimezone(): string {
  try {
    if (typeof Intl === 'undefined') return '+91';
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return '+91';
    if (tz === 'Asia/Yangon' || tz === 'Asia/Rangoon') return '+95';
    if (tz === 'Asia/Singapore') return '+65';
    if (tz === 'Asia/Dubai') return '+971';
    if (tz === 'Asia/Dhaka') return '+880';
    if (tz === 'Asia/Kathmandu' || tz === 'Asia/Katmandu') return '+977';
    if (tz === 'Europe/London') return '+44';
    if (tz === 'Europe/Berlin') return '+49';
    if (tz.startsWith('Australia/')) return '+61';
    if (tz.startsWith('America/')) return '+1';
  } catch {
    // Fallback to India (+91)
  }
  return '+91';
}

function parseInitialPhone(
  fullValue: string,
  fallbackDialCode: string
): { dialCode: string; localDigits: string } {
  const trimmed = (fullValue || '').trim();
  if (!trimmed) {
    return { dialCode: fallbackDialCode, localDigits: '' };
  }

  // Sort dial options by code length descending so +971 / +880 / +977 match before +91 / +1
  const sortedOptions = [...COUNTRY_DIAL_OPTIONS].sort(
    (a, b) => b.code.length - a.code.length
  );

  if (trimmed.startsWith('+')) {
    for (const opt of sortedOptions) {
      if (trimmed.startsWith(opt.code)) {
        const rest = trimmed
          .slice(opt.code.length)
          .replace(/\D/g, '')
          .slice(0, opt.maxDigits);
        return { dialCode: opt.code, localDigits: rest };
      }
    }
  }

  const digitsOnly = trimmed.replace(/\D/g, '').slice(0, 14);
  return { dialCode: fallbackDialCode, localDigits: digitsOnly };
}

export interface PhoneCountryInputProps {
  value: string;
  onChange: (fullE164Phone: string) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}

export function PhoneCountryInput({
  value,
  onChange,
  disabled = false,
  id,
  label = 'Mobile Number *',
}: PhoneCountryInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const selectId = `${inputId}-country`;

  const [selectedDialCode, setSelectedDialCode] = useState<string>(() => {
    const defaultCode = detectDialCodeFromTimezone();
    return parseInitialPhone(value, defaultCode).dialCode;
  });

  // Derive dial code and local digits from controlled `value` prop when possible
  const parsedFromValue = parseInitialPhone(value, selectedDialCode);
  const effectiveDialCode =
    value && value.trim().startsWith('+')
      ? parsedFromValue.dialCode
      : selectedDialCode;

  const activeOption =
    COUNTRY_DIAL_OPTIONS.find((opt) => opt.code === effectiveDialCode) ||
    COUNTRY_DIAL_OPTIONS[0];

  const localDigits = value ? parsedFromValue.localDigits : '';

  const handleDialCodeChange = (nextCode: string) => {
    setSelectedDialCode(nextCode);
    const nextOption =
      COUNTRY_DIAL_OPTIONS.find((opt) => opt.code === nextCode) ||
      COUNTRY_DIAL_OPTIONS[0];
    const clampedDigits = localDigits
      .replace(/\D/g, '')
      .slice(0, nextOption.maxDigits);
    onChange(clampedDigits ? `${nextCode}${clampedDigits}` : '');
  };

  const handleDigitsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value
      .replace(/\D/g, '')
      .slice(0, activeOption.maxDigits);
    onChange(sanitized ? `${effectiveDialCode}${sanitized}` : '');
  };

  return (
    <div className="flex items-stretch gap-2 w-full">
      <div className="relative w-[104px] sm:w-[112px] shrink-0">
        <CustomSelectModal
          id={selectId}
          testId="phone-country-select"
          value={effectiveDialCode}
          onChange={handleDialCodeChange}
          disabled={disabled}
          placeholder="Code"
          options={COUNTRY_DIAL_OPTIONS.map((opt) => ({
            value: opt.code,
            label: `${opt.flag} ${opt.code}`,
            description: opt.country,
          }))}
        />
      </div>

      <div className="relative flex-1 min-w-0">
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          maxLength={activeOption.maxDigits}
          value={localDigits}
          onChange={handleDigitsChange}
          placeholder=" "
          disabled={disabled}
          autoComplete="tel-national"
          data-testid="phone-national-input"
          className="peer w-full flex-1 min-w-0 min-h-[44px] bg-transparent border border-slate-200 dark:border-slate-800 rounded-xl px-4 pt-6 pb-2 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
        />
        <label
          htmlFor={inputId}
          className="absolute left-4 top-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-sans peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-focus:top-2 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:text-sky-500 pointer-events-none truncate max-w-[calc(100%-1.5rem)]"
        >
          {label} ({activeOption.code})
        </label>
      </div>
    </div>
  );
}

export default PhoneCountryInput;
