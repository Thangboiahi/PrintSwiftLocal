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

export const OVERRIDE_ELIGIBLE_ROLES = new Set([
  'super_admin',
  'owner',
  'admin',
]);

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

export function isSuperUserRole(role?: string | null): boolean {
  const normalized = String(role || '')
    .trim()
    .toLowerCase();
  return OVERRIDE_ELIGIBLE_ROLES.has(normalized);
}

/**
 * Enforces strict hierarchical downgrades:
 * - super_admin / admin can view as any valid role
 * - owner can only view as subordinate roles (owner, staff, visitor)
 * - all other roles keep their actual role
 */
export function resolveEffectiveRoleValue(
  realRole?: string | null,
  viewAsRole?: string | null
): string {
  const rawRole =
    String(realRole || 'visitor')
      .trim()
      .toLowerCase() || 'visitor';
  const cleanOverride = sanitizeViewAsRoleCookie(viewAsRole);
  let effectiveRole = rawRole;

  if (cleanOverride) {
    if (rawRole === 'super_admin' || rawRole === 'admin') {
      effectiveRole = cleanOverride;
    } else if (
      rawRole === 'owner' &&
      OWNER_VIEWABLE_ROLES.has(cleanOverride)
    ) {
      effectiveRole = cleanOverride;
    }
  }

  return effectiveRole;
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
