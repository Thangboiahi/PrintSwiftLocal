import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface BulletinPayPerPostConfig {
  price_inr: number;
  duration_days: number;
}

export interface PlatformLaunchSettings {
  hideSampleData: boolean;
  bulletinPayPerPost: BulletinPayPerPostConfig;
}

const DEFAULT_PAY_PER_POST: BulletinPayPerPostConfig = {
  price_inr: 79,
  duration_days: 7,
};

const STORAGE_KEY_PLATFORM_SETTINGS = 'printswift_platform_settings_v1';
const CACHE_TTL_MS = 15_000;

let memoryCache: { data: PlatformLaunchSettings; fetchedAt: number } | null = null;

function readLocalSettings(): PlatformLaunchSettings {
  if (typeof window === 'undefined') {
    return {
      hideSampleData: false,
      bulletinPayPerPost: { ...DEFAULT_PAY_PER_POST },
    };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PLATFORM_SETTINGS);
    if (!raw) {
      return {
        hideSampleData: false,
        bulletinPayPerPost: { ...DEFAULT_PAY_PER_POST },
      };
    }
    const parsed = JSON.parse(raw) as Partial<PlatformLaunchSettings>;
    return {
      hideSampleData: Boolean(parsed.hideSampleData),
      bulletinPayPerPost: {
        price_inr:
          Number(parsed.bulletinPayPerPost?.price_inr) > 0
            ? Number(parsed.bulletinPayPerPost?.price_inr)
            : DEFAULT_PAY_PER_POST.price_inr,
        duration_days:
          Number(parsed.bulletinPayPerPost?.duration_days) > 0
            ? Number(parsed.bulletinPayPerPost?.duration_days)
            : DEFAULT_PAY_PER_POST.duration_days,
      },
    };
  } catch {
    return {
      hideSampleData: false,
      bulletinPayPerPost: { ...DEFAULT_PAY_PER_POST },
    };
  }
}

function writeLocalSettings(settings: PlatformLaunchSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY_PLATFORM_SETTINGS,
      JSON.stringify(settings)
    );
    window.dispatchEvent(
      new CustomEvent('printswift:platform-settings-updated', {
        detail: settings,
      })
    );
  } catch {
    // ignore storage quota errors
  }
}

export function invalidatePlatformSettingsCache(): void {
  memoryCache = null;
}

/**
 * Reads `hide_sample_data` and `bulletin_pay_per_post` from `public.platform_settings`.
 * Uses a 15s in-memory cache and gracefully falls back to local defaults if unavailable.
 */
export async function fetchPlatformSettings(
  force = false
): Promise<PlatformLaunchSettings> {
  if (!force && memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache.data;
  }

  const fallback = readLocalSettings();

  if (!isSupabaseConfigured()) {
    memoryCache = { data: fallback, fetchedAt: Date.now() };
    return fallback;
  }

  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['hide_sample_data', 'bulletin_pay_per_post']);

    if (error || !Array.isArray(data)) {
      memoryCache = { data: fallback, fetchedAt: Date.now() };
      return fallback;
    }

    let hideSampleData = fallback.hideSampleData;
    let bulletinPayPerPost = { ...fallback.bulletinPayPerPost };

    for (const row of data as Array<{ key?: string; value?: unknown }>) {
      if (row.key === 'hide_sample_data' && row.value && typeof row.value === 'object') {
        const valObj = row.value as { enabled?: unknown };
        hideSampleData = valObj.enabled === true;
      } else if (
        row.key === 'bulletin_pay_per_post' &&
        row.value &&
        typeof row.value === 'object'
      ) {
        const valObj = row.value as {
          price_inr?: unknown;
          duration_days?: unknown;
        };
        const price = Number(valObj.price_inr);
        const days = Number(valObj.duration_days);
        bulletinPayPerPost = {
          price_inr:
            Number.isFinite(price) && price > 0
              ? Math.round(price)
              : DEFAULT_PAY_PER_POST.price_inr,
          duration_days:
            Number.isFinite(days) && days > 0
              ? Math.round(days)
              : DEFAULT_PAY_PER_POST.duration_days,
        };
      }
    }

    const resolved: PlatformLaunchSettings = {
      hideSampleData,
      bulletinPayPerPost,
    };
    memoryCache = { data: resolved, fetchedAt: Date.now() };
    writeLocalSettings(resolved);
    return resolved;
  } catch {
    memoryCache = { data: fallback, fetchedAt: Date.now() };
    return fallback;
  }
}

/**
 * Convenience accessor for Production Mode (`hide_sample_data`).
 */
export async function fetchHideSampleDataFlag(force = false): Promise<boolean> {
  const settings = await fetchPlatformSettings(force);
  return settings.hideSampleData;
}

/**
 * Exclusively for Super Admins: Persists `hide_sample_data` into `public.platform_settings`.
 */
export async function updateHideSampleDataFlag(
  enabled: boolean,
  updatedByUserId?: string | null
): Promise<{ ok: boolean; error?: string; settings: PlatformLaunchSettings }> {
  const current = await fetchPlatformSettings(false);
  const next: PlatformLaunchSettings = {
    ...current,
    hideSampleData: enabled,
  };

  memoryCache = { data: next, fetchedAt: Date.now() };
  writeLocalSettings(next);

  if (!isSupabaseConfigured()) {
    return { ok: true, settings: next };
  }

  try {
    const { error } = await supabase.from('platform_settings').upsert(
      {
        key: 'hide_sample_data',
        value: { enabled },
        updated_by: updatedByUserId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    if (error) {
      return { ok: false, error: error.message, settings: next };
    }

    return { ok: true, settings: next };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to update platform launch setting.',
      settings: next,
    };
  }
}

export function isSampleTitle(title?: string | null): boolean {
  if (!title) return false;
  return /^\s*\[sample\]/i.test(title) || /\[sample\]/i.test(title);
}
