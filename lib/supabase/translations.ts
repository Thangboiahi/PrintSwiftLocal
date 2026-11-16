import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import enMessages from '@/messages/en.json';
import mniMessages from '@/messages/mni.json';
import paiteMessages from '@/messages/paite.json';

export const SUPPORTED_LOCALES = ['en', 'mni', 'paite'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type MessagesDictionary = Record<string, Record<string, string>>;

export interface TranslationRow {
  id?: string;
  locale: SupportedLocale;
  namespace: string;
  key: string;
  value: string;
  created_at?: string;
  updated_at?: string;
}

export interface TranslationMatrixEntry {
  id: string;
  namespace: string;
  key: string;
  values: Record<SupportedLocale, string>;
  updatedAt?: string;
  source: 'supabase' | 'static' | 'merged';
}

export const STATIC_MESSAGES_BY_LOCALE: Record<
  SupportedLocale,
  MessagesDictionary
> = {
  en: enMessages as MessagesDictionary,
  mni: mniMessages as MessagesDictionary,
  paite: paiteMessages as MessagesDictionary,
};

const STORAGE_KEY_TRANSLATIONS_CACHE = 'printswift_ota_translations_v1';

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function cloneDictionary(source: MessagesDictionary): MessagesDictionary {
  const result: MessagesDictionary = {};
  for (const [ns, entries] of Object.entries(source)) {
    result[ns] = { ...entries };
  }
  return result;
}

function readBrowserTranslationOverrides(): Record<
  SupportedLocale,
  MessagesDictionary
> {
  const empty: Record<SupportedLocale, MessagesDictionary> = {
    en: {},
    mni: {},
    paite: {},
  };
  if (typeof window === 'undefined') {
    return empty;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_TRANSLATIONS_CACHE);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<
      Record<SupportedLocale, MessagesDictionary>
    >;
    return {
      en: parsed.en && typeof parsed.en === 'object' ? parsed.en : {},
      mni: parsed.mni && typeof parsed.mni === 'object' ? parsed.mni : {},
      paite:
        parsed.paite && typeof parsed.paite === 'object' ? parsed.paite : {},
    };
  } catch {
    return empty;
  }
}

function writeBrowserTranslationOverride(
  locale: SupportedLocale,
  namespace: string,
  key: string,
  value: string
): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readBrowserTranslationOverrides();
    if (!current[locale][namespace]) {
      current[locale][namespace] = {};
    }
    current[locale][namespace][key] = value;
    window.localStorage.setItem(
      STORAGE_KEY_TRANSLATIONS_CACHE,
      JSON.stringify(current)
    );
    window.dispatchEvent(
      new CustomEvent('printswift:translations-updated', {
        detail: { locale, namespace, key, value },
      })
    );
  } catch {
    // ignore storage quota errors
  }
}

function removeBrowserTranslationOverride(
  namespace: string,
  key: string
): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readBrowserTranslationOverrides();
    for (const loc of SUPPORTED_LOCALES) {
      if (current[loc][namespace]) {
        delete current[loc][namespace][key];
      }
    }
    window.localStorage.setItem(
      STORAGE_KEY_TRANSLATIONS_CACHE,
      JSON.stringify(current)
    );
    window.dispatchEvent(
      new CustomEvent('printswift:translations-updated', {
        detail: { namespace, key, deleted: true },
      })
    );
  } catch {
    // ignore storage quota errors
  }
}

function mergeDictionaries(
  base: MessagesDictionary,
  override?: MessagesDictionary
): MessagesDictionary {
  const merged = cloneDictionary(base);
  if (!override) return merged;
  for (const [namespace, entries] of Object.entries(override)) {
    if (!entries || typeof entries !== 'object') continue;
    if (!merged[namespace]) {
      merged[namespace] = {};
    }
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value === 'string') {
        merged[namespace][key] = value;
      }
    }
  }
  return merged;
}

/**
 * Fetches all translations for a specific locale from Supabase `public.translations`,
 * injecting them into a nested next-intl dictionary and falling back seamlessly
 * to local static JSON files if Supabase is unconfigured or the fetch fails.
 */
export async function fetchTranslationsForLocale(
  localeInput: string
): Promise<MessagesDictionary> {
  const locale: SupportedLocale = isSupportedLocale(localeInput)
    ? localeInput
    : 'en';
  const staticFallback = cloneDictionary(STATIC_MESSAGES_BY_LOCALE[locale]);
  const browserOverrides = readBrowserTranslationOverrides()[locale];

  if (!isSupabaseConfigured()) {
    return mergeDictionaries(staticFallback, browserOverrides);
  }

  try {
    const { data, error } = await supabase
      .from('translations')
      .select('namespace, key, value')
      .eq('locale', locale);

    if (error || !Array.isArray(data) || data.length === 0) {
      return mergeDictionaries(staticFallback, browserOverrides);
    }

    const remoteDict: MessagesDictionary = {};
    for (const row of data as Array<{
      namespace?: string;
      key?: string;
      value?: string;
    }>) {
      const ns = (row.namespace || 'common').trim();
      const k = (row.key || '').trim();
      if (!ns || !k || typeof row.value !== 'string') continue;
      if (!remoteDict[ns]) {
        remoteDict[ns] = {};
      }
      remoteDict[ns][k] = row.value;
    }

    return mergeDictionaries(
      mergeDictionaries(staticFallback, browserOverrides),
      remoteDict
    );
  } catch {
    return mergeDictionaries(staticFallback, browserOverrides);
  }
}

/**
 * Builds the combined translation matrix across English (`en`), Meitei (`mni`),
 * and Paite (`paite`) by merging Supabase `public.translations` rows over the
 * static baseline dictionaries.
 */
export async function fetchAllTranslationEntries(): Promise<{
  entries: TranslationMatrixEntry[];
  source: 'supabase' | 'fallback';
  error?: string;
}> {
  const matrix = new Map<string, TranslationMatrixEntry>();

  const ensureEntry = (
    namespace: string,
    key: string,
    source: TranslationMatrixEntry['source']
  ): TranslationMatrixEntry => {
    const id = `${namespace}::${key}`;
    const existing = matrix.get(id);
    if (existing) return existing;
    const created: TranslationMatrixEntry = {
      id,
      namespace,
      key,
      values: {
        en: '',
        mni: '',
        paite: '',
      },
      source,
    };
    matrix.set(id, created);
    return created;
  };

  // 1. Seed baseline from static JSON files
  for (const loc of SUPPORTED_LOCALES) {
    const dict = STATIC_MESSAGES_BY_LOCALE[loc];
    for (const [namespace, keysObj] of Object.entries(dict)) {
      for (const [key, val] of Object.entries(keysObj)) {
        const entry = ensureEntry(namespace, key, 'static');
        entry.values[loc] = val;
      }
    }
  }

  // 2. Apply any local browser cache overrides
  const browserCache = readBrowserTranslationOverrides();
  for (const loc of SUPPORTED_LOCALES) {
    for (const [namespace, keysObj] of Object.entries(browserCache[loc])) {
      for (const [key, val] of Object.entries(keysObj)) {
        const entry = ensureEntry(namespace, key, 'merged');
        entry.values[loc] = val;
      }
    }
  }

  const sortEntries = (list: TranslationMatrixEntry[]) =>
    list.sort((a, b) => {
      const nsCmp = a.namespace.localeCompare(b.namespace);
      if (nsCmp !== 0) return nsCmp;
      return a.key.localeCompare(b.key);
    });

  if (!isSupabaseConfigured()) {
    return {
      entries: sortEntries(Array.from(matrix.values())),
      source: 'fallback',
    };
  }

  try {
    const { data, error } = await supabase
      .from('translations')
      .select('id, locale, namespace, key, value, updated_at')
      .order('namespace', { ascending: true })
      .order('key', { ascending: true });

    if (error) {
      return {
        entries: sortEntries(Array.from(matrix.values())),
        source: 'fallback',
        error: error.message,
      };
    }

    if (Array.isArray(data)) {
      for (const raw of data as TranslationRow[]) {
        const loc = String(raw.locale || '').trim();
        const ns = String(raw.namespace || '').trim();
        const k = String(raw.key || '').trim();
        if (!isSupportedLocale(loc) || !ns || !k) continue;

        const id = `${ns}::${k}`;
        const existing = matrix.get(id);
        const entry = ensureEntry(ns, k, existing ? 'merged' : 'supabase');
        entry.values[loc] = typeof raw.value === 'string' ? raw.value : '';
        entry.source = existing?.source === 'static' ? 'merged' : 'supabase';
        if (
          raw.updated_at &&
          (!entry.updatedAt || raw.updated_at > entry.updatedAt)
        ) {
          entry.updatedAt = raw.updated_at;
        }
      }
    }

    return {
      entries: sortEntries(Array.from(matrix.values())),
      source: 'supabase',
    };
  } catch (err) {
    return {
      entries: sortEntries(Array.from(matrix.values())),
      source: 'fallback',
      error:
        err instanceof Error
          ? err.message
          : 'Failed to load remote translations.',
    };
  }
}

/**
 * Upserts a single localized translation string into `public.translations`.
 * Restricted to Super Admins (`role = 'super_admin'`) by Supabase RLS.
 */
export async function upsertTranslationEntry(input: {
  locale: SupportedLocale;
  namespace: string;
  key: string;
  value: string;
}): Promise<{ ok: boolean; error?: string }> {
  const namespace = input.namespace.trim();
  const key = input.key.trim();
  if (!namespace || !key) {
    return { ok: false, error: 'Namespace and key are required.' };
  }

  writeBrowserTranslationOverride(input.locale, namespace, key, input.value);

  if (!isSupabaseConfigured()) {
    return { ok: true };
  }

  try {
    const { error } = await supabase.from('translations').upsert(
      {
        locale: input.locale,
        namespace,
        key,
        value: input.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'locale,namespace,key' }
    );

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to save translation entry to Supabase.',
    };
  }
}

/**
 * Upserts a translation key across English, Meitei (`mni`), and Paite (`paite`)
 * in a single Supabase request. Restricted to Super Admins by RLS.
 */
export async function upsertTranslationKeyGroup(input: {
  namespace: string;
  key: string;
  values: Record<SupportedLocale, string>;
}): Promise<{ ok: boolean; error?: string }> {
  const namespace = input.namespace.trim();
  const key = input.key.trim();
  if (!namespace || !key) {
    return { ok: false, error: 'Namespace and key are required.' };
  }

  const nowIso = new Date().toISOString();
  const rows = SUPPORTED_LOCALES.map((locale) => {
    const val = input.values[locale] ?? '';
    writeBrowserTranslationOverride(locale, namespace, key, val);
    return {
      locale,
      namespace,
      key,
      value: val,
      updated_at: nowIso,
    };
  });

  if (!isSupabaseConfigured()) {
    return { ok: true };
  }

  try {
    const { error } = await supabase
      .from('translations')
      .upsert(rows, { onConflict: 'locale,namespace,key' });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to save translation key group to Supabase.',
    };
  }
}

/**
 * Deletes a translation key across all locales from `public.translations`.
 * Restricted to Super Admins (`role = 'super_admin'`) by RLS.
 */
export async function deleteTranslationKeyGroup(
  namespaceInput: string,
  keyInput: string
): Promise<{ ok: boolean; error?: string }> {
  const namespace = namespaceInput.trim();
  const key = keyInput.trim();
  if (!namespace || !key) {
    return { ok: false, error: 'Namespace and key are required.' };
  }

  removeBrowserTranslationOverride(namespace, key);

  if (!isSupabaseConfigured()) {
    return { ok: true };
  }

  try {
    const { error } = await supabase
      .from('translations')
      .delete()
      .eq('namespace', namespace)
      .eq('key', key);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to delete translation key from Supabase.',
    };
  }
}
