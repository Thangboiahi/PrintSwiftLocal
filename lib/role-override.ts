import { isVerifiedSuperAdmin } from '@/lib/auth/super-admin';

export type UserRole =
  | 'visitor'
  | 'driver'
  | 'staff'
  | 'owner'
  | 'hub_manager'
  | 'admin'
  | 'super_admin';

export const VIEW_AS_ROLE_COOKIE_NAME = 'view_as_role';
export const ACTIVE_HUB_SLUG_COOKIE_NAME = 'active_hub_slug';
export const PREVIEW_HUB_SLUG_COOKIE_NAME = 'preview_hub_slug';

export interface HubManagerPermissionEntry {
  can_confirm_manual_payments: boolean;
  can_edit_rates: boolean;
}

export type HubManagerPermissionsMap = Record<string, HubManagerPermissionEntry>;

/**
 * Pass V13-A: ONLY verified super_admin can override view_as_role perspective.
 */
export const OVERRIDE_ELIGIBLE_ROLES = new Set(['super_admin']);

export const OWNER_VIEWABLE_ROLES = new Set([
  'owner',
  'staff',
  'driver',
  'visitor',
]);

export const VIEWABLE_ROLES = new Set([
  'super_admin',
  'admin',
  'hub_manager',
  'owner',
  'staff',
  'driver',
  'visitor',
]);

export function sanitizeViewAsRoleCookie(raw?: string | null): string | null {
  const val = String(raw || '')
    .trim()
    .toLowerCase();
  if (!val || val === 'actual' || val === 'reset') {
    return null;
  }
  return VIEWABLE_ROLES.has(val) ? val : null;
}

export function isSuperUserRole(
  role?: string | null,
  email?: string | null,
  isSuperAdminFlag?: boolean | null
): boolean {
  return isVerifiedSuperAdmin(email, role, isSuperAdminFlag);
}

/**
 * v21b: Enforces DB/server-authoritative Super-Admin lock on perspective overrides.
 * - ONLY verified `super_admin` can view as another role.
 * - Non-superadmin users can NEVER spoof or escalate to `super_admin`.
 */
export function resolveEffectiveRoleValue(
  realRole?: string | null,
  viewAsRole?: string | null,
  userEmail?: string | null,
  isSuperAdminFlag?: boolean | null
): string {
  let rawRole =
    String(realRole || 'visitor')
      .trim()
      .toLowerCase() || 'visitor';

  const isSuper = isVerifiedSuperAdmin(userEmail, rawRole, isSuperAdminFlag);
  if (rawRole === 'super_admin' && !isSuper) {
    rawRole = 'visitor';
  }

  const cleanOverride = sanitizeViewAsRoleCookie(viewAsRole);
  if (!cleanOverride) {
    return rawRole;
  }

  // Only verified super_admin can use view_as_role override
  if (isSuper) {
    return cleanOverride;
  }

  return rawRole;
}

export interface ProfileWithEffectiveRole {
  id?: string;
  role?: string | null;
  actual_role?: string | null;
  admin_role?: string | null;
  role_type?: string | null;
  effective_role?: string | null;
  [key: string]: unknown;
}

export function applyEffectiveRoleToProfile<
  T extends ProfileWithEffectiveRole,
>(
  profile: T | null | undefined,
  viewAsRole?: string | null
): (T & { actual_role: string; effective_role: string; role: string }) | null {
  if (!profile) return null;
  const rawRole =
    String(
      profile.actual_role ||
        profile.role ||
        profile.admin_role ||
        profile.role_type ||
        'visitor'
    )
      .trim()
      .toLowerCase() || 'visitor';

  const effectiveRole = resolveEffectiveRoleValue(rawRole, viewAsRole);

  return {
    ...profile,
    actual_role: rawRole,
    effective_role: effectiveRole,
    role: effectiveRole,
  };
}
