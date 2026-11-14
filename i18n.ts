import { getRequestConfig } from 'next-intl/server';
import enMessages from './messages/en.json';
import mniMessages from './messages/mni.json';
import paiteMessages from './messages/paite.json';

export const locales = ['en', 'mni', 'paite'] as const;
export type SupportedLocale = (typeof locales)[number];
export const defaultLocale: SupportedLocale = 'en';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English (en)',
  mni: 'Manipuri / Meiteilon (mni)',
  paite: 'Paite (paite)',
};

export const MESSAGES_BY_LOCALE: Record<
  SupportedLocale,
  typeof enMessages
> = {
  en: enMessages,
  mni: mniMessages,
  paite: paiteMessages,
};

export function isValidLocale(value: string): value is SupportedLocale {
  return (locales as readonly string[]).includes(value);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: SupportedLocale =
    requested && isValidLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: MESSAGES_BY_LOCALE[locale],
  };
});
