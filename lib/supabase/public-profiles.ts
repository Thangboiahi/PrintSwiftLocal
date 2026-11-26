import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * v21a (P0-16): `public.profiles` is no longer world-readable (it held email / phone /
 * referral / trial data). Public bylines, author chips and username search read the safe
 * `public.public_profiles` view instead: id, username, full_name, name, avatar_url, bio,
 * role, default_hub_id.
 */
export const PUBLIC_PROFILE_COLUMNS =
  'id, username, full_name, name, avatar_url, bio, role, default_hub_id';

export interface PublicProfileRow {
  id: string;
  username?: string | null;
  full_name?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  role?: string | null;
  default_hub_id?: string | null;
}

export async function fetchPublicProfilesByIds(
  client: SupabaseClient,
  ids: Array<string | null | undefined>
): Promise<Map<string, PublicProfileRow>> {
  const unique = Array.from(
    new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))
  ).slice(0, 500);
  const map = new Map<string, PublicProfileRow>();
  if (unique.length === 0) return map;
  try {
    const { data } = await client
      .from('public_profiles')
      .select(PUBLIC_PROFILE_COLUMNS)
      .in('id', unique);
    for (const row of (data || []) as PublicProfileRow[]) {
      if (row?.id) map.set(String(row.id), row);
    }
  } catch {
    // Bylines are decorative — never break the feed
  }
  return map;
}

/**
 * Attaches `{ [targetKey]: PublicProfileRow | null }` onto each row using `idKey`
 * (default: rows' `author_id` → `profiles`, matching the old embedded-join shape).
 */
export async function attachPublicAuthorProfiles<T>(
  client: SupabaseClient,
  rows: T[] | null | undefined,
  idKey = 'author_id',
  targetKey = 'profiles'
): Promise<T[]> {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;
  const byId = await fetchPublicProfilesByIds(
    client,
    list.map((r) => String((r as Record<string, unknown>)[idKey] ?? ''))
  );
  return list.map((r) => {
    const rec = r as Record<string, unknown>;
    const authorId = String(rec[idKey] ?? '');
    return { ...rec, [targetKey]: byId.get(authorId) ?? null } as T;
  });
}
