import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import {
  applyEffectiveRoleToProfile,
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
  profile: (ProfileWithEffectiveRole & { effective_role: string }) | null;
  mapSettings: MapSettings | null;
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { viewAsRole, profile: null, mapSettings };
  }

  const token = extractAccessTokenFromCookies(cookieStore.getAll());
  if (!token) {
    return { viewAsRole, profile: null, mapSettings };
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
      return { viewAsRole, profile: null, mapSettings };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return { viewAsRole, profile: null, mapSettings };
    }
    const profileRow = profile as ProfileWithEffectiveRole;
    const actualRole =
      String(profileRow.role || 'visitor')
        .trim()
        .toLowerCase() || 'visitor';
    const rawViewAsCookie = cookieStore.get('view_as_role')?.value;
    const viewAsCookie = sanitizeViewAsRoleCookie(rawViewAsCookie);
    const canOverride = ['super_admin', 'admin', 'owner'].includes(actualRole);

    const effectiveRole =
      canOverride && viewAsCookie
        ? resolveEffectiveRoleValue(actualRole, viewAsCookie)
        : actualRole;

    const enrichedProfile = {
      ...profileRow,
      actual_role: actualRole,
      effective_role: effectiveRole,
      role: effectiveRole, // RBAC components will now see this effective role globally
    };

    const dbMapSettings = parseMapSettings(
      (profileRow as { map_settings?: unknown }).map_settings
    );
    return {
      viewAsRole: viewAsCookie,
      profile: enrichedProfile,
      mapSettings: dbMapSettings || mapSettings,
    };
  } catch {
    return { viewAsRole, profile: null, mapSettings };
  }
}
