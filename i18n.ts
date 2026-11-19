import { getRequestConfig } from 'next-intl/server';
import {
  fetchTranslationsForLocale,
  STATIC_MESSAGES_BY_LOCALE,
  SUPPORTED_LOCALES,
  type MessagesDictionary,
  type SupportedLocale,
} from '@/lib/supabase/translations';

export const locales = SUPPORTED_LOCALES;
export type { SupportedLocale };
export const defaultLocale: SupportedLocale = 'en';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English (en)',
  mni: 'Manipuri / Meiteilon (mni)',
  paite: 'Paite (paite)',
};

export const MESSAGES_BY_LOCALE: Record<SupportedLocale, MessagesDictionary> =
  STATIC_MESSAGES_BY_LOCALE;

export function isValidLocale(value: string): value is SupportedLocale {
  return (locales as readonly string[]).includes(value);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: SupportedLocale =
    requested && isValidLocale(requested) ? requested : defaultLocale;

  let messages: MessagesDictionary = MESSAGES_BY_LOCALE[locale];
  try {
    messages = await fetchTranslationsForLocale(locale);
  } catch {
    messages = MESSAGES_BY_LOCALE[locale];
  }

  return {
    locale,
    messages,
    timeZone: 'Asia/Kolkata',
  };
});
