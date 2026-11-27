/**
 * DD oodle — v21b: DB & Server-Authoritative Super-Admin Lock
 *
 * Super-Admin authority is strictly DB/server-authoritative (`profiles.role = 'super_admin'`
 * or `profiles.is_super_admin = true`), optionally cross-checked on the server against
 * `process.env.SUPER_ADMIN_EMAILS`. No personal email addresses are bundled into client TS.
 * Non-superadmin users must NEVER be able to see, toggle, or spoof `super_admin`
 * in client state, RoleToggleModal, localStorage, cookies, or server APIs.
 */

export const HARDCODED_SUPER_ADMIN_EMAILS: readonly string[] = [];

export const VIEW_AS_ROLE_STORAGE_KEYS = [
  'dd_view_as_role',
  'view_as_role',
  'psl_view_as_role',
  'psl_preview_hub_slug',
] as const;

function getConfiguredSuperAdminEmailSet(): Set<string> {
  const allowed = new Set<string>();

  // Strictly server-only allowlist via process.env.SUPER_ADMIN_EMAILS
  if (
    typeof window === 'undefined' &&
    typeof process !== 'undefined' &&
    process.env?.SUPER_ADMIN_EMAILS
  ) {
    const extra = String(process.env.SUPER_ADMIN_EMAILS)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    for (const email of extra) {
      allowed.add(email);
    }
  }

  return allowed;
}

/**
 * Checks whether an email matches the server-only `SUPER_ADMIN_EMAILS` env var.
 * Always returns `false` in client bundles or when `SUPER_ADMIN_EMAILS` is unset.
 */
export function isHardcodedSuperAdminEmail(email?: string | null): boolean {
  if (typeof window !== 'undefined') return false;
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return getConfiguredSuperAdminEmailSet().has(normalized);
}

/**
 * DB/server-authoritative verification for `super_admin` privileges.
 * Trusts DB `profiles.role === 'super_admin'` or `profiles.is_super_admin === true`.
 * On the server, when `process.env.SUPER_ADMIN_EMAILS` is configured, also requires
 * the email to match that server allowlist.
 */
export function isVerifiedSuperAdmin(
  email?: string | null,
  dbRole?: string | null,
  isSuperAdminFlag?: boolean | null
): boolean {
  const normalizedRole = String(dbRole || '')
    .trim()
    .toLowerCase();
  const hasDbPrivilege =
    normalizedRole === 'super_admin' || isSuperAdminFlag === true;
  if (!hasDbPrivilege) return false;

  if (typeof window === 'undefined') {
    const configured = getConfiguredSuperAdminEmailSet();
    if (configured.size > 0) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      return Boolean(normalizedEmail && configured.has(normalizedEmail));
    }
  }

  return true;
}

/**
 * Purges any stale or spoofed `dd_view_as_role` / `view_as_role` entries
 * from localStorage and document.cookie when a non-superadmin user is active.
 */
export function clearUnauthorizedViewRoleState(): void {
  if (typeof window !== 'undefined') {
    try {
      for (const key of VIEW_AS_ROLE_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore storage errors
    }
  }
  if (typeof document !== 'undefined') {
    try {
      document.cookie =
        'view_as_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      document.cookie =
        'preview_hub_slug=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    } catch {
      // ignore cookie errors
    }
  }
}
