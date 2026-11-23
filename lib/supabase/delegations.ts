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
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface StaffDelegationRecord {
  id: string;
  listing_id: string;
  staff_id: string;
  staff_name: string;
  staff_email: string;
  permissions: StaffPermissionsJson;
  granted_at: string;
}

function normalizePermissionsJson(raw: unknown): StaffPermissionsJson {
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
 * Fetches all staff delegations for a given `listingId`, resolving staff names and emails
 * via a relational join or secondary lookup against `public.profiles`.
 */
export async function fetchDelegations(
  listingId: string
): Promise<StaffDelegationRecord[]> {
  if (!listingId || !isUuid(listingId) || !isSupabaseConfigured()) {
    return [];
  }

  const trimmedListingId = listingId.trim();

  // Attempt relational join with profiles first
  const { data: joinedData, error: joinError } = await supabase
    .from('staff_delegations')
    .select('*, profiles(id, full_name, email)')
    .eq('listing_id', trimmedListingId)
    .order('granted_at', { ascending: false });

  type RawDelegationRow = {
    id: string;
    listing_id: string;
    staff_id: string;
    staff_name?: string | null;
    staff_email?: string | null;
    permissions?: unknown;
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

    rows = Array.isArray(baseRows)
      ? (baseRows as unknown as RawDelegationRow[])
      : [];
  }

  // Collect any staff_ids missing profile details for batch secondary lookup
  const missingStaffIds = Array.from(
    new Set(
      rows
        .filter((r) => !r.profiles && !r.staff_email && r.staff_id)
        .map((r) => r.staff_id)
    )
  );

  const profileMap = new Map<string, SupabaseProfileSummary>();
  if (missingStaffIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', missingStaffIds);

    if (Array.isArray(profilesData)) {
      for (const p of profilesData as SupabaseProfileSummary[]) {
        profileMap.set(p.id, p);
      }
    }
  }

  return rows.map((row) => {
    const joinedProfile = Array.isArray(row.profiles)
      ? row.profiles[0] ?? null
      : row.profiles ?? profileMap.get(row.staff_id) ?? null;

    const resolvedEmail =
      joinedProfile?.email || row.staff_email || 'staff@ddoodle.in';
    const resolvedName =
      joinedProfile?.full_name ||
      joinedProfile?.name ||
      row.staff_name ||
      resolvedEmail.split('@')[0] ||
      'Staff Agent';

    return {
      id: row.id,
      listing_id: row.listing_id,
      staff_id: row.staff_id,
      staff_name: resolvedName,
      staff_email: resolvedEmail,
      permissions: normalizePermissionsJson(row.permissions),
      granted_at: row.granted_at || new Date().toISOString(),
    };
  });
}

/**
 * Adds a staff delegate to a listing by looking up `staffEmail` in `public.profiles`
 * and inserting a record into `public.staff_delegations` with the specified JSON permissions.
 */
export async function addDelegate(
  listingId: string,
  staffEmail: string,
  permissions: StaffPermissionsJson
): Promise<StaffDelegationRecord> {
  if (!listingId || !isUuid(listingId)) {
    throw new Error('Save listing first to assign staff members.');
  }

  const normalizedEmail = staffEmail.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Please enter a valid staff email address.');
  }

  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase backend is not configured. Please check your environment variables.'
    );
  }

  // 1. Resolve staffEmail to an existing profiles record
  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to verify staff profile: ${profileError.message}`);
  }

  if (!profileRow || !profileRow.id) {
    throw new Error(
      `No user profile found for "${normalizedEmail}". Please ensure the staff member has registered an account first.`
    );
  }

  const profile = profileRow as SupabaseProfileSummary;

  // 2. Insert into staff_delegations
  const { data: insertedRow, error: insertError } = await supabase
    .from('staff_delegations')
    .insert({
      listing_id: listingId.trim(),
      staff_id: profile.id,
      permissions,
    })
    .select('*')
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  const row = insertedRow as {
    id: string;
    listing_id: string;
    staff_id: string;
    permissions?: unknown;
    granted_at?: string | null;
  };

  return {
    id: row.id,
    listing_id: row.listing_id,
    staff_id: row.staff_id,
    staff_name:
      profile.full_name ||
      profile.name ||
      (profile.email ? profile.email.split('@')[0] : 'Staff Agent'),
    staff_email: profile.email || normalizedEmail,
    permissions: normalizePermissionsJson(row.permissions ?? permissions),
    granted_at: row.granted_at || new Date().toISOString(),
  };
}

/**
 * Removes a staff delegation record by its `delegationId`.
 */
export async function removeDelegate(
  delegationId: string
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

  return { deletedId: delegationId.trim() };
}
