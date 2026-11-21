// =============================================================================
// Phase 75-B: Isolated Real Estate Server Helpers (Auth, Kill-Switch, RPCs)
// =============================================================================

import { randomBytes, randomInt } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

export interface AuthenticatedRealEstateActor {
  supabaseAdmin: SupabaseClient;
  userToken: string | null;
  userId: string;
  actualRole: string;
  profile: {
    id: string;
    role: string;
    full_name: string | null;
    phone: string | null;
  };
}

export class RealEstateApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = 'REAL_ESTATE_API_ERROR') {
    super(message);
    this.name = 'RealEstateApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function generateVisitRequestCode(): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const suffix = String(randomInt(1000, 10000));
  return `DDV-${yy}${mm}-${suffix}`;
}

export function generateRealEstateIntentCode(): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PSL-${suffix}`;
}

export async function authenticateRealEstateRequest(
  req: NextRequest
): Promise<AuthenticatedRealEstateActor | null> {
  const supabaseAdmin = createServerSupabaseAdminClient();
  const token = extractSupabaseAccessToken(req);

  let userId: string | null = null;

  if (token) {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (!error && user?.id) {
      userId = user.id;
    }
  }

  if (!userId) {
    try {
      const serverSession = await getServerSessionContext();
      if (serverSession.profile?.id) {
        userId = String(serverSession.profile.id);
      }
    } catch {
      // Ignore cookie-context errors outside active request scope
    }
  }

  if (!userId) return null;

  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, phone')
    .eq('id', userId)
    .maybeSingle();

  const role = String(profileRow?.role || 'visitor');

  return {
    supabaseAdmin,
    userToken: token,
    userId,
    actualRole: role,
    profile: {
      id: userId,
      role,
      full_name:
        typeof profileRow?.full_name === 'string'
          ? profileRow.full_name
          : null,
      phone: typeof profileRow?.phone === 'string' ? profileRow.phone : null,
    },
  };
}

/**
 * Checks whether the hub's `module_switches.real_estate` switch is enabled.
 * Throws RealEstateApiError(503) when paused.
 */
export async function assertRealEstateModuleEnabledForHub(
  supabaseAdmin: SupabaseClient,
  hubId: string | null | undefined
): Promise<void> {
  if (!hubId) return;

  const { data: hubRow } = await supabaseAdmin
    .from('service_hubs')
    .select('id, name, module_switches')
    .eq('id', hubId)
    .maybeSingle();

  if (!hubRow) return;

  const switches =
    hubRow.module_switches && typeof hubRow.module_switches === 'object'
      ? (hubRow.module_switches as Record<string, unknown>)
      : {};
  const rawSwitch = switches.real_estate;

  let enabled = true;
  let pauseMessage = '';

  if (typeof rawSwitch === 'boolean') {
    enabled = rawSwitch;
  } else if (rawSwitch && typeof rawSwitch === 'object') {
    const obj = rawSwitch as { enabled?: unknown; pause_message?: unknown };
    if (obj.enabled === false) enabled = false;
    if (typeof obj.pause_message === 'string') {
      pauseMessage = obj.pause_message.trim();
    }
  }

  if (!enabled) {
    throw new RealEstateApiError(
      pauseMessage ||
        `Real Estate services are temporarily paused in ${hubRow.name || 'this hub'}.`,
      503,
      'REAL_ESTATE_MODULE_PAUSED'
    );
  }
}

/**
 * Verifies whether `userId` is an authorized operator for `listingId`
 * (owner, active delegated staff, or super_admin).
 */
export async function isRealEstateOperatorForUser(
  supabaseAdmin: SupabaseClient,
  listingId: string,
  userId: string,
  actualRole: string
): Promise<boolean> {
  if (actualRole.trim().toLowerCase() === 'super_admin') {
    return true;
  }

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, owner_id')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return false;
  if (listing.owner_id === userId) return true;

  const { data: delegation } = await supabaseAdmin
    .from('staff_delegations')
    .select('id')
    .eq('listing_id', listingId)
    .eq('staff_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  return Boolean(delegation?.id);
}

/**
 * Checks `has_active_real_estate_pro(p_listing_id)` RPC safely.
 */
export async function hasActiveRealEstatePro(
  supabaseAdmin: SupabaseClient,
  listingId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('has_active_real_estate_pro', {
    p_listing_id: listingId,
  });
  if (error) return false;
  return data === true;
}
