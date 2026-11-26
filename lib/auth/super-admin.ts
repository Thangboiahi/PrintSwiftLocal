/**
 * DD oodle — Pass V13-A: Canonical Hardcoded Super-Admin Lock
 *
 * Defines the single source of truth for Super-Admin identity verification.
 * Non-superadmin users must NEVER be able to see, toggle, or spoof `super_admin`
 * in client state, RoleToggleModal, localStorage, cookies, or server APIs.
 */

/**
 * MUST stay in sync with SQL `public.is_hardcoded_super_admin_email()` (v21a) and the
 * `enforce_profile_role_governance()` elevation rule. Both allowlists contain exactly these emails.
 */
export const HARDCODED_SUPER_ADMIN_EMAILS = [
  'thangboiahi@gmail.com',
  'homeautomation.dd@gmail.com',
] as const;

export const VIEW_AS_ROLE_STORAGE_KEYS = [
  'dd_view_as_role',
  'view_as_role',
  'psl_view_as_role',
  'psl_preview_hub_slug',
] as const;

function getConfiguredSuperAdminEmailSet(): Set<string> {
  const allowed = new Set<string>(
    HARDCODED_SUPER_ADMIN_EMAILS.map((e) => e.trim().toLowerCase())
  );

  // Server-only optional override via process.env.SUPER_ADMIN_EMAILS
  if (typeof process !== 'undefined' && process.env?.SUPER_ADMIN_EMAILS) {
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
 * Returns true ONLY if the provided email matches the canonical hardcoded
 * Super-Admin allowlist (plus optional server env `SUPER_ADMIN_EMAILS`).
 */
export function isHardcodedSuperAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return getConfiguredSuperAdminEmailSet().has(normalized);
}

/**
 * Strict dual-lock check: requires BOTH the hardcoded Super-Admin email
 * AND the database profile role `'super_admin'`.
 */
export function isVerifiedSuperAdmin(
  email?: string | null,
  dbRole?: string | null
): boolean {
  if (!isHardcodedSuperAdminEmail(email)) return false;
  const normalizedRole = String(dbRole || '')
    .trim()
    .toLowerCase();
  return normalizedRole === 'super_admin';
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
