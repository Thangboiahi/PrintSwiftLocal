import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { isVerifiedSuperAdmin } from '@/lib/auth/super-admin';
import {
  resolveEffectiveRoleValue,
  sanitizeViewAsRoleCookie,
} from '@/lib/role-override';

export type WorkspaceHatId =
  | 'owner'
  | 'staff'
  | 'driver'
  | 'mediator'
  | 'hub_manager'
  | 'advertiser'
  | 'admin'
  | 'super_admin'
  | 'master_control';

export type CanonicalWorkspaceHat =
  | 'owner'
  | 'staff'
  | 'driver'
  | 'mediator'
  | 'hub_manager'
  | 'advertiser'
  | 'master_control';

export interface WorkspaceAccessContext {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  fullName: string | null;
  actualRole: string;
  effectiveRole: string;
  isSuperAdmin: boolean;
  authorizedHats: CanonicalWorkspaceHat[];
  hatCounts: Partial<Record<CanonicalWorkspaceHat, number>>;
  managedHubIds: string[];
}

const ADMIN_ROLE_SET = new Set<string>([
  'admin',
  'super_admin',
  'listing_moderator',
  'verification_officer',
  'community_moderator',
  'customer_support',
  'finance_admin',
  'analytics_viewer',
]);

export function normalizeWorkspaceHatParam(
  raw: string | null | undefined
): CanonicalWorkspaceHat | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'owner' || cleaned === 'business') return 'owner';
  if (cleaned === 'staff') return 'staff';
  if (cleaned === 'driver') return 'driver';
  if (cleaned === 'mediator' || cleaned === 'dispatch_mediator') {
    return 'mediator';
  }
  if (cleaned === 'hub' || cleaned === 'hub_manager') return 'hub_manager';
  if (
    cleaned === 'advertiser' ||
    cleaned === 'bulletin' ||
    cleaned === 'bulletins'
  ) {
    return 'advertiser';
  }
  if (
    cleaned === 'master_control' ||
    cleaned === 'admin' ||
    cleaned === 'super_admin'
  ) {
    return 'master_control';
  }
  return null;
}

export function getWorkspaceRouteForHat(hat: CanonicalWorkspaceHat): string {
  switch (hat) {
    case 'owner':
      return '/workspace/owner';
    case 'staff':
      return '/workspace/staff';
    case 'driver':
      return '/workspace/driver';
    case 'mediator':
      return '/workspace/mediator';
    case 'hub_manager':
      return '/workspace/hub';
    case 'advertiser':
      return '/workspace/advertiser';
    case 'master_control':
      return '/admin';
  }
}

function extractFallbackAccessToken(
  allCookies: Array<{ name: string; value: string }>
): string | null {
  const direct = allCookies.find(
    (c) => c.name === 'sb-access-token' || c.name === 'supabase-auth-token'
  );
  if (direct?.value) {
    try {
      return decodeURIComponent(direct.value);
    } catch {
      return direct.value;
    }
  }

  // Reassemble chunked @supabase/ssr cookies (e.g. sb-<ref>-auth-token.0, .1, .2)
  const exactCookie = allCookies.find(
    (c) => /^sb-.*-auth-token$/.test(c.name) && c.value
  );
  let combinedRaw = exactCookie?.value || '';

  if (!combinedRaw) {
    const chunkedCookies = allCookies
      .filter((c) => /^sb-.*-auth-token\.\d+$/.test(c.name) && c.value)
      .sort((a, b) => {
        const idxA = Number(a.name.split('.').pop() || 0);
        const idxB = Number(b.name.split('.').pop() || 0);
        return idxA - idxB;
      });
    if (chunkedCookies.length > 0) {
      combinedRaw = chunkedCookies.map((c) => c.value).join('');
    }
  }

  if (!combinedRaw) return null;

  let rawVal = combinedRaw;
  try {
    rawVal = combinedRaw.startsWith('base64-')
      ? Buffer.from(combinedRaw.slice(7), 'base64').toString('utf8')
      : decodeURIComponent(combinedRaw);
  } catch {
    rawVal = combinedRaw;
  }

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
 * Resolves the authenticated user's canonical workspace hats from Supabase on the server.
 */
export async function resolveServerWorkspaceContext(): Promise<WorkspaceAccessContext> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    // When Supabase is not configured in local/CI preview, return unauthenticated context
    return {
      isAuthenticated: false,
      userId: null,
      userEmail: null,
      fullName: null,
      actualRole: 'visitor',
      effectiveRole: 'visitor',
      isSuperAdmin: false,
      authorizedHats: [],
      hatCounts: {},
      managedHubIds: [],
    };
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();

  const ssrSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return allCookies;
      },
      setAll() {
        // Server Components cannot mutate response cookies directly
      },
    },
  });

  const withAuthTimeout = <T, F = T>(
    promise: PromiseLike<T>,
    fallback: F,
    ms = 5000
  ): Promise<T | F> =>
    Promise.race([
      Promise.resolve(promise),
      new Promise<F>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  let user: { id: string; email?: string | null } | null = null;
  let activeClient = ssrSupabase;

  try {
    const { data } = await withAuthTimeout(ssrSupabase.auth.getUser(), {
      data: { user: null },
      error: null,
    });
    if (data?.user?.id) {
      user = data.user;
    }
  } catch {
    // fallback to explicit token cookie below
  }

  if (!user) {
    const fallbackToken = extractFallbackAccessToken(allCookies);
    if (fallbackToken) {
      try {
        const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: {
            headers: {
              Authorization: `Bearer ${fallbackToken}`,
            },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        const { data } = await withAuthTimeout(
          tokenClient.auth.getUser(fallbackToken),
          { data: { user: null }, error: null }
        );
        if (data?.user?.id) {
          user = data.user;
          activeClient = tokenClient as unknown as typeof ssrSupabase;
        }
      } catch {
        // unauthenticated
      }
    }
  }

  if (!user?.id) {
    return {
      isAuthenticated: false,
      userId: null,
      userEmail: null,
      fullName: null,
      actualRole: 'visitor',
      effectiveRole: 'visitor',
      isSuperAdmin: false,
      authorizedHats: [],
      hatCounts: {},
      managedHubIds: [],
    };
  }

  const [profileRes, hatsRes, advertiserBulletinsRes, partnerAppsRes] =
    await withAuthTimeout(
      Promise.allSettled([
        activeClient
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle(),
        activeClient.rpc('get_user_operational_hats', { p_user_id: user.id }),
        activeClient
          .from('bulletins')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', user.id),
        activeClient
          .from('partner_applications')
          .select('application_type, status')
          .eq('applicant_id', user.id)
          .eq('status', 'approved'),
      ]),
      [
        { status: 'rejected', reason: 'timeout' },
        { status: 'rejected', reason: 'timeout' },
        { status: 'rejected', reason: 'timeout' },
        { status: 'rejected', reason: 'timeout' },
      ] as [
        PromiseSettledResult<{ data: unknown; error: unknown }>,
        PromiseSettledResult<{ data: unknown; error: unknown }>,
        PromiseSettledResult<{ count: number | null; error: unknown }>,
        PromiseSettledResult<{ data: unknown; error: unknown }>,
      ],
      5000
    );

  const profileRow =
    profileRes.status === 'fulfilled' && profileRes.value.data
      ? (profileRes.value.data as {
          role?: string | null;
          admin_role?: string | null;
          is_super_admin?: boolean | null;
          full_name?: string | null;
        })
      : null;

  const hatsPayload =
    hatsRes.status === 'fulfilled' &&
    !hatsRes.value.error &&
    hatsRes.value.data &&
    typeof hatsRes.value.data === 'object'
      ? (hatsRes.value.data as {
          platform_role?: string;
          owned_listings_count?: number;
          owned_vehicles_count?: number;
          active_staff_assignments?: Array<{ listing_id?: string }>;
          driver_profile?: Record<string, unknown> | null;
          managed_hubs?: Array<{ hub_id?: string }>;
        })
      : null;

  const rawDbRole = String(
    profileRow?.admin_role ||
      profileRow?.role ||
      hatsPayload?.platform_role ||
      'visitor'
  )
    .trim()
    .toLowerCase();

  const verifiedSuper = isVerifiedSuperAdmin(
    user.email,
    rawDbRole,
    profileRow?.is_super_admin
  );

  const actualRole =
    rawDbRole === 'super_admin' || profileRow?.is_super_admin === true
      ? verifiedSuper
        ? 'super_admin'
        : 'visitor'
      : rawDbRole || 'visitor';

  const viewAsCookie = verifiedSuper
    ? sanitizeViewAsRoleCookie(cookieStore.get('view_as_role')?.value)
    : null;

  const effectiveRole =
    verifiedSuper && viewAsCookie
      ? resolveEffectiveRoleValue(actualRole, viewAsCookie, user.email)
      : actualRole;

  const ownedListingsCount = Number(hatsPayload?.owned_listings_count ?? 0);
  const ownedVehiclesCount = Number(hatsPayload?.owned_vehicles_count ?? 0);
  const ownerTotalCount = ownedListingsCount + ownedVehiclesCount;
  const staffAssignmentsCount = Array.isArray(
    hatsPayload?.active_staff_assignments
  )
    ? hatsPayload.active_staff_assignments.length
    : 0;
  const hasDriverProfile = Boolean(
    hatsPayload?.driver_profile &&
      typeof hatsPayload.driver_profile === 'object'
  );
  const managedHubIds = Array.isArray(hatsPayload?.managed_hubs)
    ? hatsPayload.managed_hubs
        .map((m) => String(m?.hub_id || '').trim())
        .filter(Boolean)
    : [];

  const bulletinsCount =
    advertiserBulletinsRes.status === 'fulfilled'
      ? Number(advertiserBulletinsRes.value.count ?? 0)
      : 0;

  const approvedPartnerTracks = new Set<string>();
  if (
    partnerAppsRes.status === 'fulfilled' &&
    Array.isArray(partnerAppsRes.value.data)
  ) {
    for (const app of partnerAppsRes.value.data as Array<{
      application_type?: string | null;
    }>) {
      if (app.application_type) {
        approvedPartnerTracks.add(app.application_type.toLowerCase());
      }
    }
  }

  const isRoleOverridden = Boolean(
    verifiedSuper && viewAsCookie && effectiveRole !== actualRole
  );
  const isEffectiveAdmin =
    ADMIN_ROLE_SET.has(effectiveRole) ||
    (!isRoleOverridden && verifiedSuper);

  const authorizedHats: CanonicalWorkspaceHat[] = [];
  const hatCounts: Partial<Record<CanonicalWorkspaceHat, number>> = {};

  if (isRoleOverridden) {
    if (effectiveRole === 'owner') {
      authorizedHats.push('owner');
    } else if (effectiveRole === 'staff') {
      authorizedHats.push('staff');
    } else if (effectiveRole === 'advertiser') {
      authorizedHats.push('advertiser');
    } else if (effectiveRole === 'driver') {
      authorizedHats.push('driver');
    } else if (effectiveRole === 'mediator') {
      authorizedHats.push('mediator');
    } else if (effectiveRole === 'hub_manager') {
      authorizedHats.push('mediator', 'hub_manager');
    } else if (ADMIN_ROLE_SET.has(effectiveRole)) {
      authorizedHats.push('mediator', 'master_control');
    }
  } else {
    if (
      ownerTotalCount > 0 ||
      effectiveRole === 'owner' ||
      approvedPartnerTracks.has('business') ||
      isEffectiveAdmin
    ) {
      authorizedHats.push('owner');
      if (ownerTotalCount > 0) hatCounts.owner = ownerTotalCount;
    }

    if (
      staffAssignmentsCount > 0 ||
      effectiveRole === 'staff' ||
      isEffectiveAdmin
    ) {
      authorizedHats.push('staff');
      if (staffAssignmentsCount > 0) hatCounts.staff = staffAssignmentsCount;
    }

    if (
      effectiveRole === 'advertiser' ||
      effectiveRole === 'owner' ||
      ownerTotalCount > 0 ||
      bulletinsCount > 0 ||
      approvedPartnerTracks.has('advertiser') ||
      approvedPartnerTracks.has('business') ||
      isEffectiveAdmin
    ) {
      authorizedHats.push('advertiser');
      if (bulletinsCount > 0) hatCounts.advertiser = bulletinsCount;
    }

    if (
      hasDriverProfile ||
      effectiveRole === 'driver' ||
      approvedPartnerTracks.has('driver') ||
      isEffectiveAdmin
    ) {
      authorizedHats.push('driver');
    }

    if (
      effectiveRole === 'mediator' ||
      effectiveRole === 'hub_manager' ||
      managedHubIds.length > 0 ||
      isEffectiveAdmin
    ) {
      authorizedHats.push('mediator');
    }

    if (
      managedHubIds.length > 0 ||
      effectiveRole === 'hub_manager' ||
      isEffectiveAdmin
    ) {
      authorizedHats.push('hub_manager');
    }

    if (isEffectiveAdmin) {
      authorizedHats.push('master_control');
    }
  }

  return {
    isAuthenticated: true,
    userId: user.id,
    userEmail: user.email || null,
    fullName: profileRow?.full_name || null,
    actualRole,
    effectiveRole,
    isSuperAdmin: verifiedSuper,
    authorizedHats,
    hatCounts,
    managedHubIds,
  };
}

/**
 * Server-side workspace access guard.
 * 1. Verifies `supabase.auth.getUser()` on the server; unauthenticated visitors immediately
 *    `redirect('/login?next=' + encodeURIComponent(nextPath))`.
 * 2. Checks canonical access from Postgres (`profiles.role` / `is_super_admin`, active
 *    `staff_delegations`, active `drivers`, active `hub_managers`, owned listings/vehicles
 *    or partner access for `owner`/`advertiser`).
 * 3. Redirects unauthorized users server-side to `/workspace?denied=<hat>` BEFORE rendering
 *    any workspace component or shipping its client JS bundle.
 */
export async function requireWorkspaceAccess(
  allowedHats: WorkspaceHatId[],
  nextPath: string
): Promise<WorkspaceAccessContext> {
  const ctx = await resolveServerWorkspaceContext();

  if (!ctx.isAuthenticated || !ctx.userId) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const normalizedAllowed = new Set<CanonicalWorkspaceHat>();
  for (const h of allowedHats) {
    const norm = normalizeWorkspaceHatParam(h);
    if (norm) normalizedAllowed.add(norm);
  }

  const isAllowed = Array.from(normalizedAllowed).some((hat) =>
    ctx.authorizedHats.includes(hat)
  );

  if (!isAllowed) {
    const deniedKey = allowedHats[0] || 'workspace';
    redirect(`/workspace?denied=${encodeURIComponent(deniedKey)}`);
  }

  return ctx;
}
