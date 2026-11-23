'use client';

import React from 'react';
import {
  PhoneInputWithCountry,
  COUNTRY_DIAL_OPTIONS,
  type CountryDialOption,
} from '@/components/ui/PhoneInputWithCountry';

export { COUNTRY_DIAL_OPTIONS, type CountryDialOption };

interface PhoneCountryInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (fullPhone: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  testId?: string;
}

export function PhoneCountryInput({
  id,
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  error,
  testId = 'phone-country-input',
}: PhoneCountryInputProps) {
  return (
    <PhoneInputWithCountry
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      error={error}
      testId={testId}
      variant="floating"
    />
  );
}

export default PhoneCountryInput;
