'use client';

import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { AdminRole, Listing, UserAccount, UserRoleType } from '@/lib/types';

export type GovernedUserRole =
  | 'visitor'
  | 'staff'
  | 'owner'
  | 'admin'
  | 'super_admin';

export interface AdminManagedUser extends UserAccount {
  fullName: string;
  role: GovernedUserRole;
  avatarUrl?: string;
}

export interface AppSettingRecord {
  id?: string;
  setting_key: string;
  setting_value: string;
  updated_at?: string;
}

export interface AppSettingsMap {
  show_sample_data: boolean;
  [key: string]: string | boolean;
}

const STORAGE_KEY_APP_SETTINGS = 'printswift_local_app_settings_v1';

const DEFAULT_APP_SETTINGS: AppSettingsMap = {
  show_sample_data: true,
};

function readCachedAppSettings(): AppSettingsMap {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_APP_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_APP_SETTINGS);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
      show_sample_data:
        parsed.show_sample_data === undefined
          ? true
          : parsed.show_sample_data === true ||
            String(parsed.show_sample_data).toLowerCase() === 'true',
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function writeCachedAppSettings(settings: AppSettingsMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY_APP_SETTINGS,
      JSON.stringify(settings)
    );
    window.dispatchEvent(
      new CustomEvent('printswift:app-settings-updated', { detail: settings })
    );
  } catch {
    // ignore storage quota errors
  }
}

export function normalizeGovernedRole(rawRole: unknown): GovernedUserRole {
  const cleaned = String(rawRole || 'visitor')
    .trim()
    .toLowerCase();
  if (cleaned === 'super_admin' || cleaned === 'superadmin') {
    return 'super_admin';
  }
  if (
    cleaned === 'admin' ||
    cleaned === 'listing_moderator' ||
    cleaned === 'verification_officer' ||
    cleaned === 'community_moderator' ||
    cleaned === 'customer_support' ||
    cleaned === 'finance_admin' ||
    cleaned === 'analytics_viewer'
  ) {
    return 'admin';
  }
  if (cleaned === 'owner') return 'owner';
  if (cleaned === 'staff') return 'staff';
  return 'visitor';
}

export function mapGovernedRoleToAccountFields(role: GovernedUserRole): {
  roleType: UserRoleType;
  adminRole?: AdminRole;
} {
  if (role === 'super_admin') {
    return { roleType: 'admin', adminRole: 'super_admin' };
  }
  if (role === 'admin') {
    return { roleType: 'admin', adminRole: 'super_admin' };
  }
  if (role === 'owner') {
    return { roleType: 'owner', adminRole: undefined };
  }
  if (role === 'staff') {
    return { roleType: 'staff', adminRole: undefined };
  }
  return { roleType: 'visitor', adminRole: undefined };
}

function mapProfileRowToAdminUser(
  row: Record<string, unknown>
): AdminManagedUser {
  const id = String(row.id || '');
  const email = String(row.email || '');
  const fullName = String(
    row.full_name ||
      row.name ||
      (email ? email.split('@')[0] : '') ||
      'Registered User'
  ).trim();
  const governedRole = normalizeGovernedRole(
    row.role || row.admin_role || row.role_type || 'visitor'
  );
  const { roleType, adminRole } = mapGovernedRoleToAccountFields(governedRole);
  const explicitAdminRole = row.admin_role
    ? (String(row.admin_role) as AdminRole)
    : adminRole;

  return {
    id,
    name: fullName,
    fullName,
    email,
    role: governedRole,
    roleType,
    adminRole: explicitAdminRole,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    joinedAt: row.created_at
      ? String(row.created_at).slice(0, 10)
      : row.updated_at
        ? String(row.updated_at).slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    avatarLabel: fullName.slice(0, 2).toUpperCase() || 'US',
    avatarUrl: resolveRemoteMediaUrl(String(row.avatar_url || '')),
    description: String(
      row.bio || row.description || `Platform ${governedRole.replace('_', ' ')}`
    ),
  };
}

/**
 * Exclusively for Super Admins: Fetches all registered user profiles from Supabase `public.profiles`.
 */
export async function fetchAllUsers(): Promise<AdminManagedUser[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      const fallback = await supabase.from('profiles').select('*');
      if (fallback.error || !Array.isArray(fallback.data)) {
        return [];
      }
      return fallback.data.map((row) =>
        mapProfileRowToAdminUser(row as Record<string, unknown>)
      );
    }

    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((row) =>
      mapProfileRowToAdminUser(row as Record<string, unknown>)
    );
  } catch {
    return [];
  }
}

/**
 * Exclusively for Super Admins: Updates a target user's role in `public.profiles`.
 * Enforced by backend RLS so only `role = 'super_admin'` can execute updates on other users' roles.
 */
export async function updateUserRole(
  userId: string,
  newRole: GovernedUserRole | string
): Promise<{ ok: boolean; user?: AdminManagedUser; error?: string }> {
  const cleanId = (userId || '').trim();
  if (!cleanId) {
    return { ok: false, error: 'A valid userId is required.' };
  }

  const normalizedRole = normalizeGovernedRole(newRole);
  const dbRoleValue =
    normalizedRole === 'admin' ? 'super_admin' : normalizedRole;

  if (!isSupabaseConfigured()) {
    return { ok: true };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        role: dbRoleValue,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cleanId)
      .select('*')
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('printswift:profile-updated'));
    }

    return {
      ok: true,
      user: data
        ? mapProfileRowToAdminUser(data as Record<string, unknown>)
        : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to update user role.',
    };
  }
}

/**
 * Fetches global platform settings from `public.app_settings` (such as `show_sample_data`).
 */
export async function fetchAppSettings(): Promise<AppSettingsMap> {
  const cached = readCachedAppSettings();

  if (!isSupabaseConfigured()) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('id, setting_key, setting_value, updated_at');

    if (error || !Array.isArray(data)) {
      return cached;
    }

    const merged: AppSettingsMap = { ...cached };
    for (const row of data as AppSettingRecord[]) {
      if (!row?.setting_key) continue;
      const rawVal = String(row.setting_value ?? '').trim();
      if (
        rawVal.toLowerCase() === 'true' ||
        rawVal.toLowerCase() === 'false'
      ) {
        merged[row.setting_key] = rawVal.toLowerCase() === 'true';
      } else {
        merged[row.setting_key] = rawVal;
      }
    }

    writeCachedAppSettings(merged);
    return merged;
  } catch {
    return cached;
  }
}

/**
 * Exclusively for Super Admins: Updates or inserts a global platform setting in `public.app_settings`.
 */
export async function updateAppSetting(
  key: string,
  value: string | boolean
): Promise<{ ok: boolean; settings: AppSettingsMap; error?: string }> {
  const cleanKey = (key || '').trim();
  const serializedValue = String(value);
  const current = readCachedAppSettings();
  const nextSettings: AppSettingsMap = {
    ...current,
    [cleanKey]:
      typeof value === 'boolean'
        ? value
        : serializedValue.toLowerCase() === 'true'
          ? true
          : serializedValue.toLowerCase() === 'false'
            ? false
            : serializedValue,
  };

  writeCachedAppSettings(nextSettings);

  if (!isSupabaseConfigured()) {
    return { ok: true, settings: nextSettings };
  }

  try {
    const { error } = await supabase.from('app_settings').upsert(
      {
        setting_key: cleanKey,
        setting_value: serializedValue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'setting_key' }
    );

    if (error) {
      return {
        ok: false,
        settings: nextSettings,
        error: error.message,
      };
    }

    return { ok: true, settings: nextSettings };
  } catch (err) {
    return {
      ok: false,
      settings: nextSettings,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to update setting in Supabase.',
    };
  }
}

/**
 * Identifies whether a listing is a `[SAMPLE]` or demo listing so it can be hidden
 * from the public map when `show_sample_data` is disabled by a Super Admin.
 */
export function isSampleListing(listing: Listing): boolean {
  if (!listing) return false;
  if (listing.isFeaturedDemo) return true;
  if (
    typeof listing.title === 'string' &&
    /\[sample\]|\(sample\)|\bdemo\b/i.test(listing.title)
  ) {
    return true;
  }
  if (
    typeof listing.description === 'string' &&
    /\[sample\]/i.test(listing.description)
  ) {
    return true;
  }
  if (
    typeof listing.id === 'string' &&
    /^(sample-|demo-|re-sample|srv-sample|pub-sample|spt-sample)/i.test(
      listing.id
    )
  ) {
    return true;
  }
  return false;
}
