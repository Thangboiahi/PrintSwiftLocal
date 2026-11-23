/**
 * DD oodle — Pass V13-A: Staging Role Test Accounts & 1-Tap Login Config
 *
 * // REMOVE BEFORE LIVE PRODUCTION LAUNCH
 * Guarded by a single flag `ENABLE_DEV_ROLE_SHORTCUTS`. Set
 * `NEXT_PUBLIC_DISABLE_TEST_SHORTCUTS=true` in production environment variables
 * to hide all test login shortcuts immediately.
 */

// REMOVE BEFORE LIVE PRODUCTION LAUNCH
export const ENABLE_DEV_ROLE_SHORTCUTS =
  process.env.NEXT_PUBLIC_DISABLE_TEST_SHORTCUTS !== 'true';

export const DEV_TEST_ROLE_PASSWORD =
  process.env.NEXT_PUBLIC_DEV_TEST_PASSWORD || 'Test@1234';

export type DevTestRoleId =
  | 'visitor'
  | 'owner'
  | 'staff'
  | 'driver'
  | 'hub_manager'
  | 'super_admin';

export interface DevTestRoleAccount {
  id: DevTestRoleId;
  roleLabel: string;
  shortLabel: string;
  email: string;
  username: string;
  fullName: string;
  phone: string;
  /** Null for Super Admin so personal password is NEVER stored in client code */
  prefillPassword: string | null;
  autoSignIn: boolean;
  dbRole: 'visitor' | 'owner' | 'staff' | 'driver' | 'hub_manager' | 'super_admin';
  badgeTone: string;
  restrictionNote: string;
}

export const DEV_TEST_ROLE_ACCOUNTS: readonly DevTestRoleAccount[] = [
  {
    id: 'visitor',
    roleLabel: 'Visitor / Customer',
    shortLabel: 'Visitor',
    email: 'visitor.test@ddoodle.in',
    username: 'test_visitor',
    fullName: 'Liankhan Visitor (Test)',
    phone: '+919862010001',
    prefillPassword: DEV_TEST_ROLE_PASSWORD,
    autoSignIn: true,
    dbRole: 'visitor',
    badgeTone:
      'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-200',
    restrictionNote:
      'Zero operational hats · Pure Lamka customer discovery, ordering & booking flow.',
  },
  {
    id: 'owner',
    roleLabel: 'Business Owner',
    shortLabel: 'Owner',
    email: 'owner.test@ddoodle.in',
    username: 'test_owner',
    fullName: 'angaihte Business Owner (Test)',
    phone: '+919862010002',
    prefillPassword: DEV_TEST_ROLE_PASSWORD,
    autoSignIn: true,
    dbRole: 'owner',
    badgeTone:
      'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
    restrictionNote:
      'Owns an active Lamka listing with composable plan quotas & feature gates enforced.',
  },
  {
    id: 'staff',
    roleLabel: 'Delegated Staff',
    shortLabel: 'Staff',
    email: 'staff.test@ddoodle.in',
    username: 'test_staff',
    fullName: 'Chingnu Delegated Staff (Test)',
    phone: '+919862010003',
    prefillPassword: DEV_TEST_ROLE_PASSWORD,
    autoSignIn: true,
    dbRole: 'staff',
    badgeTone:
      'border-sky-500/40 bg-sky-500/12 text-sky-700 dark:text-sky-300',
    restrictionNote:
      'Assigned to Owner test listing with scoped permissions & vertical intersection.',
  },
  {
    id: 'driver',
    roleLabel: 'Verified Driver',
    shortLabel: 'Driver',
    email: 'driver.test@ddoodle.in',
    username: 'test_driver',
    fullName: 'Paumin Driver Fleet (Test)',
    phone: '+919862010004',
    prefillPassword: DEV_TEST_ROLE_PASSWORD,
    autoSignIn: true,
    dbRole: 'driver',
    badgeTone:
      'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300',
    restrictionNote:
      'Active verified driver_profiles record in Lamka · Real Driver Dispatch Console.',
  },
  {
    id: 'hub_manager',
    roleLabel: 'Hub Manager (Lamka)',
    shortLabel: 'Hub Manager',
    email: 'manager.lamka@ddoodle.in',
    username: 'test_manager_lamka',
    fullName: 'Lamka Hub Manager (Test)',
    phone: '+919862010005',
    prefillPassword: DEV_TEST_ROLE_PASSWORD,
    autoSignIn: true,
    dbRole: 'hub_manager',
    badgeTone:
      'border-indigo-500/40 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
    restrictionNote:
      'Strictly scoped to Lamka (Churachandpur) hub · Cannot access Aizawl or Master Control.',
  },
  {
    id: 'super_admin',
    roleLabel: 'Super Admin (Locked)',
    shortLabel: 'Super Admin',
    email: 'thangboiahi@gmail.com',
    username: 'dd_thang',
    fullName: 'Thangboi Super Admin',
    phone: '+919862010000',
    prefillPassword: null,
    autoSignIn: false,
    dbRole: 'super_admin',
    badgeTone:
      'border-purple-500/45 bg-purple-500/15 text-purple-700 dark:text-purple-300',
    restrictionNote:
      'Prefills email only — enter your real password to unlock Master Control & View-As Switcher.',
  },
] as const;
