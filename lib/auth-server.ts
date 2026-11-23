import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { isHardcodedSuperAdminEmail } from '@/lib/auth/super-admin';
import {
  ACTIVE_HUB_SLUG_COOKIE_NAME,
  applyEffectiveRoleToProfile,
  type HubManagerPermissionsMap,
  PREVIEW_HUB_SLUG_COOKIE_NAME,
  resolveEffectiveRoleValue,
  sanitizeViewAsRoleCookie,
  type ProfileWithEffectiveRole,
  type UserRole,
} from './role-override';
import {
  MAP_SETTINGS_COOKIE_NAME,
  parseMapSettings,
  type MapSettings,
} from './map-settings';

export type { UserRole };

export interface ServerSessionContext {
  viewAsRole: string | null;
  previewHubSlug?: string | null;
  profile:
    | (ProfileWithEffectiveRole & {
        effective_role: string;
        managedHubIds?: string[];
        hubManagerPermissions?: HubManagerPermissionsMap;
        canConfirmManualPaymentsByHub?: Record<string, boolean>;
        canEditRatesByHub?: Record<string, boolean>;
      })
    | null;
  mapSettings: MapSettings | null;
  managedHubIds: string[];
  hubManagerPermissions: HubManagerPermissionsMap;
  canConfirmManualPaymentsByHub: Record<string, boolean>;
  canEditRatesByHub: Record<string, boolean>;
}

/**
 * Resolves the effective role for server-side layouts, pages, or API routes,
 * allowing super users (super_admin, admin, owner) to override their visible role
 * via the `view_as_role` cookie for preview testing without logging out.
 */
export async function getEffectiveServerRole(realRole: string): Promise<string> {
  const cookieStore = await cookies();
  const viewAsRole = cookieStore.get('view_as_role')?.value;
  return resolveEffectiveRoleValue(realRole, viewAsRole);
}

function extractAccessTokenFromCookies(
  allCookies: Array<{ name: string; value: string }>
): string | null {
  const directToken = allCookies.find(
    (c) => c.name === 'sb-access-token' || c.name === 'supabase-auth-token'
  );
  if (directToken?.value) {
    return directToken.value;
  }

  const sbAuthCookie = allCookies.find(
    (c) => /^sb-.*-auth-token$/.test(c.name) && c.value
  );
  if (!sbAuthCookie?.value) return null;

  const rawVal = sbAuthCookie.value.startsWith('base64-')
    ? Buffer.from(sbAuthCookie.value.slice(7), 'base64').toString('utf8')
    : decodeURIComponent(sbAuthCookie.value);

  try {
    const parsed = JSON.parse(rawVal) as
      | { access_token?: string }
      | [string, ...unknown[]];
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return parsed[0];
    }
    if (
      parsed &&
      !Array.isArray(parsed) &&
      typeof parsed.access_token === 'string'
    ) {
      return parsed.access_token;
    }
  } catch {
    // ignore malformed cookie
  }

  return null;
}

/**
 * Fetches the active user profile on the server (when session cookies exist),
 * reads `view_as_role` from `next/headers` cookies, and sets `profile.effective_role`
 * BEFORE passing profile data to client components.
 */
export async function getServerSessionContext(): Promise<ServerSessionContext> {
  const cookieStore = await cookies();
  const viewAsRole = sanitizeViewAsRoleCookie(
    cookieStore.get('view_as_role')?.value
  );
  const mapSettings = parseMapSettings(
    cookieStore.get(MAP_SETTINGS_COOKIE_NAME)?.value
  );

  const previewHubSlug =
    (
      cookieStore.get(PREVIEW_HUB_SLUG_COOKIE_NAME)?.value ||
      cookieStore.get(ACTIVE_HUB_SLUG_COOKIE_NAME)?.value ||
      ''
    )
      .trim()
      .toLowerCase() || null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const emptyHubPerms = {
    previewHubSlug,
    managedHubIds: [] as string[],
    hubManagerPermissions: {} as HubManagerPermissionsMap,
    canConfirmManualPaymentsByHub: {} as Record<string, boolean>,
    canEditRatesByHub: {} as Record<string, boolean>,
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    return { viewAsRole, profile: null, mapSettings, ...emptyHubPerms };
  }

  const token = extractAccessTokenFromCookies(cookieStore.getAll());
  if (!token) {
    return { viewAsRole, profile: null, mapSettings, ...emptyHubPerms };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user?.id) {
      return { viewAsRole, profile: null, mapSettings, ...emptyHubPerms };
    }

    const [profileRes, hubManagersRes, activeHubsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      Promise.resolve(
        supabase
          .from('hub_managers')
          .select(
            'hub_id, can_confirm_manual_payments, can_edit_rates, is_active'
          )
          .eq('profile_id', user.id)
          .eq('is_active', true)
      ).catch(() => ({ data: null, error: null })),
      Promise.resolve(
        supabase
          .from('service_hubs')
          .select('id, slug, status')
          .in('status', ['active', 'coming_soon'])
          .order('sort_order', { ascending: true })
      ).catch(() => ({ data: null, error: null })),
    ]);

    const profile = profileRes.data;
    if (!profile) {
      return { viewAsRole, profile: null, mapSettings, ...emptyHubPerms };
    }

    const managedHubIds: string[] = [];
    const hubManagerPermissions: HubManagerPermissionsMap = {};
    const canConfirmManualPaymentsByHub: Record<string, boolean> = {};
    const canEditRatesByHub: Record<string, boolean> = {};

    if (!hubManagersRes.error && Array.isArray(hubManagersRes.data)) {
      for (const hm of hubManagersRes.data as Array<{
        hub_id?: string | null;
        can_confirm_manual_payments?: boolean | null;
        can_edit_rates?: boolean | null;
        is_active?: boolean | null;
      }>) {
        if (!hm.hub_id || hm.is_active === false) continue;
        const hid = String(hm.hub_id).trim();
        if (!hid) continue;
        if (!managedHubIds.includes(hid)) {
          managedHubIds.push(hid);
        }
        const canConfirm = Boolean(hm.can_confirm_manual_payments);
        const canEdit = Boolean(hm.can_edit_rates);
        canConfirmManualPaymentsByHub[hid] = canConfirm;
        canEditRatesByHub[hid] = canEdit;
        hubManagerPermissions[hid] = {
          can_confirm_manual_payments: canConfirm,
          can_edit_rates: canEdit,
        };
      }
    }

    const profileRow = profile as ProfileWithEffectiveRole;
    const rawDbRole =
      String(profileRow.role || 'visitor')
        .trim()
        .toLowerCase() || 'visitor';
    const isVerifiedSuperAdminUser =
      rawDbRole === 'super_admin' && isHardcodedSuperAdminEmail(user.email);

    // Pass V13-A: Strict dual lock — super_admin requires BOTH profile.role === 'super_admin' AND isHardcodedSuperAdminEmail(user.email)
    const actualRole =
      rawDbRole === 'super_admin'
        ? isVerifiedSuperAdminUser
          ? 'super_admin'
          : 'visitor'
        : rawDbRole;

    const rawViewAsCookie = cookieStore.get('view_as_role')?.value;
    const viewAsCookie = isVerifiedSuperAdminUser
      ? sanitizeViewAsRoleCookie(rawViewAsCookie)
      : null;

    const effectiveRole =
      isVerifiedSuperAdminUser && viewAsCookie
        ? resolveEffectiveRoleValue(actualRole, viewAsCookie, user.email)
        : actualRole;

    if (
      (actualRole === 'super_admin' || actualRole === 'admin') &&
      !activeHubsRes.error &&
      Array.isArray(activeHubsRes.data)
    ) {
      const activeHubRows = (
        activeHubsRes.data as Array<{
          id?: string | null;
          slug?: string | null;
          status?: string | null;
        }>
      ).filter((h) => h.id && h.status === 'active');

      if (previewHubSlug) {
        const matchedPreview = activeHubRows.find(
          (h) => String(h.slug || '').toLowerCase() === previewHubSlug
        );
        if (matchedPreview?.id) {
          const pid = String(matchedPreview.id).trim();
          if (!managedHubIds.includes(pid)) {
            managedHubIds.unshift(pid);
          }
        }
      }

      for (const h of activeHubRows) {
        const hid = String(h.id || '').trim();
        if (!hid) continue;
        if (!managedHubIds.includes(hid)) {
          managedHubIds.push(hid);
        }
        if (!hubManagerPermissions[hid]) {
          hubManagerPermissions[hid] = {
            can_confirm_manual_payments: Boolean(
              canConfirmManualPaymentsByHub[hid]
            ),
            can_edit_rates: Boolean(canEditRatesByHub[hid]),
          };
        }
      }
    }

    const enrichedProfile = {
      ...profileRow,
      actual_role: actualRole,
      effective_role: effectiveRole,
      role: effectiveRole, // RBAC components will now see this effective role globally
      managedHubIds,
      hubManagerPermissions,
      canConfirmManualPaymentsByHub,
      canEditRatesByHub,
    };

    const dbMapSettings = parseMapSettings(
      (profileRow as { map_settings?: unknown }).map_settings
    );
    return {
      viewAsRole: viewAsCookie,
      previewHubSlug,
      profile: enrichedProfile,
      mapSettings: dbMapSettings || mapSettings,
      managedHubIds,
      hubManagerPermissions,
      canConfirmManualPaymentsByHub,
      canEditRatesByHub,
    };
  } catch {
    return { viewAsRole, profile: null, mapSettings, ...emptyHubPerms };
  }
}
