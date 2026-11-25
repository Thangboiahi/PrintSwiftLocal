/**
 * Pre-configured Dev/Test Role Accounts for 1-Tap Role Verification
 *
 * SECURITY GUARDRAIL:
 * - Gated cleanly behind NEXT_PUBLIC_ENABLE_DEMO_AUTH (or non-production dev preview when not explicitly disabled).
 * - Uses standard Supabase signInWithPassword against pre-seeded test users.
 * - Never grants or elevates roles on the client; roles come strictly from
 *   Supabase `profiles.role`, `drivers`, `staff_delegations`, and `hub_managers`.
 */

import { isDemoAuthEnabled } from '@/lib/env';

export interface DevTestAccount {
  id: string;
  label: string;
  shortLabel: string;
  roleBadge: string;
  email: string;
  password: string;
  fullName: string;
  phone: string;
  dbRole: 'visitor' | 'owner' | 'staff' | 'driver' | 'hub_manager' | 'admin' | 'super_admin';
  targetRoute: string;
  description: string;
  accentColor: string;
}

export const DEV_TEST_DEFAULT_PASSWORD =
  process.env.NEXT_PUBLIC_DEV_TEST_PASSWORD || 'DDoodleTest#2026!';

/**
 * Phase 44 Demo Auth Lock:
 * Strictly opt-in — Demo Auth shortcuts are rendered ONLY when
 * `NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true'`. Hidden and disabled by default.
 */
export const ENABLE_DEV_ROLE_SHORTCUTS: boolean = isDemoAuthEnabled();

export const DEV_TEST_ACCOUNTS: DevTestAccount[] = [
  {
    id: 'customer',
    label: 'Visitor / Customer',
    shortLabel: 'Customer',
    roleBadge: 'VISITOR',
    email: 'visitor.test@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'Liani Visitor (Test)',
    phone: '+919862000001',
    dbRole: 'visitor',
    targetRoute: '/explore',
    description: 'Browse map, book turf/hotels, request Pick N Drop & save places',
    accentColor: 'bg-slate-800 text-white hover:bg-slate-700 border-slate-700',
  },
  {
    id: 'owner',
    label: 'Business Owner',
    shortLabel: 'Owner',
    roleBadge: 'OWNER',
    email: 'owner.test@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'Thangaihte Business Owner (Test)',
    phone: '+919862000002',
    dbRole: 'owner',
    targetRoute: '/workspace?hat=owner',
    description: 'Manage verified listings, marketplace catalog, hours & customer enquiries',
    accentColor: 'bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-500',
  },
  {
    id: 'staff',
    label: 'Shop Staff / Operator',
    shortLabel: 'Staff',
    roleBadge: 'STAFF',
    email: 'staff.test@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'Muan Shop Staff (Test)',
    phone: '+919862000005',
    dbRole: 'staff',
    targetRoute: '/workspace?hat=staff',
    description: 'Delegated counter operator for shop inventory, print jobs & order fulfillment',
    accentColor: 'bg-cyan-700 text-white hover:bg-cyan-600 border-cyan-600',
  },
  {
    id: 'driver',
    label: 'Fleet Driver / Rider',
    shortLabel: 'Driver',
    roleBadge: 'DRIVER',
    email: 'driver.test@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'Pauminthang Rider (Test)',
    phone: '+919862000003',
    dbRole: 'driver',
    targetRoute: '/workspace?hat=driver',
    description: 'Accept Pick N Drop dispatch jobs, verify OTP stages & upload POD',
    accentColor: 'bg-emerald-600 text-white hover:bg-emerald-500 border-emerald-500',
  },
  {
    id: 'advertiser',
    label: 'Advertiser / Organizer',
    shortLabel: 'Advertiser',
    roleBadge: 'ADVERTISER',
    email: 'advertiser.test@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'Zoram Community Advertiser (Test)',
    phone: '+919862000006',
    dbRole: 'owner',
    targetRoute: '/bulletin',
    description: 'Publish district bulletins, job notices, events & YouTube video broadcasts',
    accentColor: 'bg-rose-600 text-white hover:bg-rose-500 border-rose-500',
  },
  {
    id: 'hub_manager',
    label: 'Dispatch Booker / Hub Mediator',
    shortLabel: 'Mediator',
    roleBadge: 'HUB_MANAGER',
    email: 'manager.lamka@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'Kham Suan (Lamka Hub Manager)',
    phone: '+919862000004',
    dbRole: 'hub_manager',
    targetRoute: '/workspace?hat=hub_manager',
    description: 'Churachandpur / Lamka UPI escrow mediator, dispatch booker & hub verifier',
    accentColor: 'bg-amber-600 text-white hover:bg-amber-500 border-amber-500',
  },
  {
    id: 'admin',
    label: 'Platform Admin',
    shortLabel: 'Admin',
    roleBadge: 'ADMIN',
    email: 'admin.test@ddoodle.in',
    password: DEV_TEST_DEFAULT_PASSWORD,
    fullName: 'DD oodle Platform Admin (Test)',
    phone: '+919862000007',
    dbRole: 'admin',
    targetRoute: '/workspace?hat=master_control',
    description: 'Full platform moderation, featured slots, KYC approval & escrow oversight',
    accentColor: 'bg-purple-700 text-white hover:bg-purple-600 border-purple-600',
  },
];

export const SUPER_ADMIN_EMAIL = 'thangboiahi@gmail.com';
