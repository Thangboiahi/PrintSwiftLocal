import { isUuid } from '@/lib/payments/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface StaffPermissionsJson {
  can_edit_details?: boolean;
  can_manage_media?: boolean;
  can_manage_catalogue?: boolean;
  can_reply_enquiries?: boolean;
  can_reply_reviews?: boolean;
  can_view_analytics?: boolean;
  [key: string]: boolean | undefined;
}

export interface SupabaseProfileSummary {
  id: string;
  username?: string | null;
  full_name?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
}

export interface StaffDelegationRecord {
  id: string;
  listing_id: string;
  staff_id: string;
  staff_username: string;
  staff_name: string;
  staff_email: string;
  staff_avatar_url?: string | null;
  permissions: StaffPermissionsJson;
  vertical_scopes: string[];
  status?: 'active' | 'suspended' | 'revoked' | string;
  granted_at: string;
  isStagedDraft?: boolean;
}

export function normalizePermissionsJson(raw: unknown): StaffPermissionsJson {
  if (!raw) {
    return {
      can_edit_details: false,
      can_manage_media: false,
    };
  }

  if (Array.isArray(raw)) {
    const result: StaffPermissionsJson = {};
    for (const item of raw) {
      if (typeof item === 'string') {
        const key = item.startsWith('can_') ? item : `can_${item}`;
        result[key] = true;
      }
    }
    return result;
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const result: StaffPermissionsJson = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = Boolean(v);
    }
    return result;
  }

  return {
    can_edit_details: false,
    can_manage_media: false,
  };
}

/**
 * Fetches all staff delegations for a given `listingId`, resolving staff `@username`,
 * display name, avatar, and `vertical_scopes` without exposing private email addresses in UI.
 */
export async function fetchDelegations(
  listingId: string
): Promise<StaffDelegationRecord[]> {
  if (!listingId || !isUuid(listingId) || !isSupabaseConfigured()) {
    return [];
  }

  const trimmedListingId = listingId.trim();

  // Attempt relational join with profiles first (include active & suspended so Owners can reactivate or revoke)
  const { data: joinedData, error: joinError } = await supabase
    .from('staff_delegations')
    .select('*, profiles:staff_id(id, username, full_name, avatar_url)')
    .eq('listing_id', trimmedListingId)
    .in('status', ['active', 'suspended', 'inactive'])
    .order('granted_at', { ascending: false });

  type RawDelegationRow = {
    id: string;
    listing_id: string;
    staff_id: string;
    staff_name?: string | null;
    staff_email?: string | null;
    status?: string | null;
    permissions?: unknown;
    vertical_scopes?: unknown;
    granted_at?: string | null;
    profiles?: SupabaseProfileSummary | SupabaseProfileSummary[] | null;
  };

  let rows: RawDelegationRow[] = [];

  if (!joinError && Array.isArray(joinedData)) {
    rows = joinedData as unknown as RawDelegationRow[];
  } else {
    const { data: baseRows, error: baseError } = await supabase
      .from('staff_delegations')
      .select('*')
      .eq('listing_id', trimmedListingId)
      .order('granted_at', { ascending: false });

    if (baseError) {
      throw new Error(baseError.message);
    }

    rows = (Array.isArray(baseRows)
      ? (baseRows as unknown as RawDelegationRow[])
      : []
    ).filter((r) => !r.status || r.status !== 'revoked');
  }

  // Secondary lookup for profiles
  const allStaffIds = Array.from(
    new Set(rows.map((r) => r.staff_id).filter(Boolean))
  );

  const profileMap = new Map<string, SupabaseProfileSummary>();

  if (allStaffIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .in('id', allStaffIds);

    if (Array.isArray(profilesData)) {
      for (const p of profilesData as SupabaseProfileSummary[]) {
        profileMap.set(p.id, p);
      }
    }
  }

  return rows.map((row) => {
    const joinedProfile = Array.isArray(row.profiles)
      ? row.profiles[0] ?? profileMap.get(row.staff_id) ?? null
      : row.profiles ?? profileMap.get(row.staff_id) ?? null;

    const fallbackHandle = `user_${String(row.staff_id || '')
      .replace(/-/g, '')
      .slice(0, 6)}`;
    const resolvedUsername = (
      joinedProfile?.username ||
      (row.staff_email ? row.staff_email.split('@')[0] : '') ||
      fallbackHandle
    )
      .replace(/^@+/, '')
      .toLowerCase();

    const resolvedName =
      joinedProfile?.full_name ||
      joinedProfile?.name ||
      row.staff_name ||
      resolvedUsername ||
      'Team Member';

    let resolvedScopes: string[] = ['enquiries'];
    if (Array.isArray(row.vertical_scopes)) {
      resolvedScopes = row.vertical_scopes.map((s) => String(s));
    } else if (row.vertical_scopes && typeof row.vertical_scopes === 'object') {
      const obj = row.vertical_scopes as Record<string, unknown>;
      const keys = Object.entries(obj)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([k]) => k);
      if (keys.length > 0) resolvedScopes = keys;
    }

    return {
      id: row.id,
      listing_id: row.listing_id,
      staff_id: row.staff_id,
      staff_username: resolvedUsername,
      staff_name: resolvedName,
      staff_email: `@${resolvedUsername}`,
      staff_avatar_url: joinedProfile?.avatar_url || null,
      permissions: normalizePermissionsJson(row.permissions),
      vertical_scopes: resolvedScopes,
      status: row.status || 'active',
      granted_at: row.granted_at || new Date().toISOString(),
    };
  });
}

/**
 * Assigns a staff member by their verified user profile ID (`@username` selection)
 * with custom individual permissions and operational scopes.
 */
export async function addDelegateByUserId(
  listingId: string,
  staffProfile: {
    id: string;
    username: string;
    full_name: string;
    avatar_url?: string | null;
  },
  permissions: StaffPermissionsJson,
  verticalScopes: string[] = ['enquiries']
): Promise<StaffDelegationRecord> {
  if (!listingId || !isUuid(listingId)) {
    throw new Error('Save listing first to assign staff members.');
  }
  if (!staffProfile?.id || !isUuid(staffProfile.id)) {
    throw new Error('Please select a valid user by @username.');
  }
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase backend is not configured.');
  }

  const trimmedListingId = listingId.trim();

  // Check if already delegated on this listing
  const { data: existingRow } = await supabase
    .from('staff_delegations')
    .select('id')
    .eq('listing_id', trimmedListingId)
    .eq('staff_id', staffProfile.id)
    .maybeSingle();

  let delegationId = existingRow?.id ? String(existingRow.id) : '';
  let grantedAt = new Date().toISOString();

  if (delegationId) {
    const { data: updatedRow, error: updateErr } = await supabase
      .from('staff_delegations')
      .update({
        status: 'active',
        permissions,
        vertical_scopes: verticalScopes,
        staff_name: staffProfile.full_name || staffProfile.username,
      })
      .eq('id', delegationId)
      .select('*')
      .single();

    if (updateErr) {
      throw new Error(updateErr.message);
    }
    if (updatedRow?.granted_at) {
      grantedAt = String(updatedRow.granted_at);
    }
  } else {
    const { data: insertedRow, error: insertError } = await supabase
      .from('staff_delegations')
      .insert({
        listing_id: trimmedListingId,
        staff_id: staffProfile.id,
        status: 'active',
        permissions,
        vertical_scopes: verticalScopes,
        staff_name: staffProfile.full_name || staffProfile.username,
      })
      .select('*')
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }
    delegationId = String(insertedRow.id);
    if (insertedRow?.granted_at) {
      grantedAt = String(insertedRow.granted_at);
    }
  }

  const cleanUsername = staffProfile.username.replace(/^@+/, '').toLowerCase();

  return {
    id: delegationId,
    listing_id: trimmedListingId,
    staff_id: staffProfile.id,
    staff_username: cleanUsername,
    staff_name: staffProfile.full_name || cleanUsername,
    staff_email: `@${cleanUsername}`,
    staff_avatar_url: staffProfile.avatar_url || null,
    permissions: normalizePermissionsJson(permissions),
    vertical_scopes: verticalScopes,
    status: 'active',
    granted_at: grantedAt,
  };
}

/**
 * Updates an individual staff member's permissions and vertical scopes on a listing.
 */
export async function updateDelegatePermissions(
  delegationId: string,
  _listingId: string,
  _staffId: string,
  permissions: StaffPermissionsJson,
  verticalScopes: string[] = ['enquiries']
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const { error } = await supabase
    .from('staff_delegations')
    .update({
      permissions,
      vertical_scopes: verticalScopes,
      status: 'active',
    })
    .eq('id', delegationId.trim());

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Transitions a staff delegation status (`active`, `suspended`, `revoked`).
 * Server-side trigger `trg_enforce_and_audit_staff_delegation_v18a` enforces `max_staff`
 * when reactivating and immediately cuts off RLS access on `suspended`/`revoked`.
 */
export async function updateDelegateStatus(
  delegationId: string,
  nextStatus: 'active' | 'suspended' | 'revoked'
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const { error } = await supabase
    .from('staff_delegations')
    .update({ status: nextStatus })
    .eq('id', delegationId.trim());

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Resolves a registered user profile by email or `+91` phone number for staff delegation.
 */
export async function lookupUserProfileByContact(
  contactValue: string
): Promise<{
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
} | null> {
  if (!isSupabaseConfigured()) return null;
  const cleaned = contactValue.trim();
  if (!cleaned) return null;

  const digits = cleaned.replace(/\D/g, '');
  const isEmail = cleaned.includes('@') && !cleaned.startsWith('@');

  let query = supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .limit(1);

  if (isEmail) {
    query = query.ilike('email', cleaned);
  } else if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    query = query.or(
      `phone.ilike.%${last10}%,phone_number.ilike.%${last10}%`
    );
  } else {
    const handle = cleaned.replace(/^@+/, '');
    query = query.ilike('username', handle);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as Record<string, unknown>;
  if (!row.id) return null;

  const fallbackUsername =
    typeof row.username === 'string' && row.username.trim()
      ? row.username.trim().replace(/^@+/, '')
      : `user_${String(row.id).replace(/-/g, '').slice(0, 6)}`;

  return {
    id: String(row.id),
    username: fallbackUsername,
    full_name:
      typeof row.full_name === 'string' && row.full_name.trim()
        ? row.full_name.trim()
        : fallbackUsername,
    avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
  };
}

/**
 * Legacy helper accepting `@username` or email string and delegating to `addDelegateByUserId`.
 */
export async function addDelegate(
  listingId: string,
  staffHandleOrEmail: string,
  permissions: StaffPermissionsJson
): Promise<StaffDelegationRecord> {
  if (!listingId || !isUuid(listingId)) {
    throw new Error('Save listing first to assign staff members.');
  }
  const cleaned = staffHandleOrEmail.trim().replace(/^@+/, '').toLowerCase();
  if (!cleaned) {
    throw new Error('Please select a staff member by @username.');
  }
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase backend is not configured.');
  }

  const { data: rpcRows } = await supabase.rpc('search_users_by_username', {
    p_query: cleaned,
    p_limit: 5,
  });

  let matched: {
    id: string;
    username: string;
    full_name: string;
    avatar_url?: string | null;
  } | null = null;

  if (Array.isArray(rpcRows) && rpcRows.length > 0) {
    const exact =
      rpcRows.find(
        (r: Record<string, unknown>) =>
          String(r.username || '').toLowerCase() === cleaned
      ) || rpcRows[0];
    matched = {
      id: String(exact.id),
      username: String(exact.username || cleaned),
      full_name: String(exact.full_name || cleaned),
      avatar_url:
        typeof exact.avatar_url === 'string' ? exact.avatar_url : null,
    };
  } else {
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .or(`username.ilike.${cleaned},email.ilike.${cleaned}`)
      .maybeSingle();

    if (profileError || !profileRow?.id) {
      throw new Error(
        `No registered user found matching "@${cleaned}". Please search by their @username.`
      );
    }
    matched = {
      id: String(profileRow.id),
      username: String(profileRow.username || cleaned),
      full_name: String(profileRow.full_name || cleaned),
      avatar_url:
        typeof profileRow.avatar_url === 'string'
          ? profileRow.avatar_url
          : null,
    };
  }

  return addDelegateByUserId(listingId, matched, permissions);
}

/**
 * Removes a staff delegation record by its `delegationId`.
 */
export async function removeDelegate(
  delegationId: string,
  listingId?: string | null,
  staffId?: string | null
): Promise<{ deletedId: string }> {
  if (!delegationId || !delegationId.trim()) {
    throw new Error('Delegation ID is required to remove a staff member.');
  }

  if (!isSupabaseConfigured()) {
    return { deletedId: delegationId };
  }

  const { error } = await supabase
    .from('staff_delegations')
    .delete()
    .eq('id', delegationId.trim());

  if (error) {
    throw new Error(error.message);
  }

  if (listingId && isUuid(listingId) && staffId && isUuid(staffId)) {
    try {
      await supabase
        .from('listing_staff_assignments')
        .delete()
        .eq('listing_id', listingId.trim())
        .eq('staff_user_id', staffId.trim());
    } catch {
      // Non-blocking
    }
  }

  return { deletedId: delegationId.trim() };
}
