'use client';

import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/supabase/public-profiles';

export interface SupabaseProfileRow {
  id: string;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_phone?: string | null;
  role?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  social_links?: Record<string, string> | null;
  updated_at?: string | null;
}

export interface LiveUserProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
  avatarUrl: string;
  bio: string;
  socialLinks: Record<string, string>;
}

const profileCache = new Map<string, LiveUserProfile>();
const inflightProfileRequests = new Map<
  string,
  Promise<LiveUserProfile | null>
>();

export function mapRowToLiveProfile(row: SupabaseProfileRow): LiveUserProfile {
  const resolvedName = (
    row.full_name ||
    row.name ||
    (row.email ? row.email.split('@')[0] : '') ||
    'Verified Local Member'
  ).trim();

  const parsedSocials: Record<string, string> = {};
  if (
    row.social_links &&
    typeof row.social_links === 'object' &&
    !Array.isArray(row.social_links)
  ) {
    for (const [key, val] of Object.entries(row.social_links)) {
      if (typeof val === 'string' && val.trim()) {
        parsedSocials[key] = val.trim();
      }
    }
  }

  return {
    id: row.id,
    fullName: resolvedName,
    email: (row.email || '').trim(),
    phone: (row.phone || row.contact_phone || '').trim(),
    role: (row.role || 'owner').trim(),
    avatarUrl: resolveRemoteMediaUrl(row.avatar_url || ''),
    bio: (row.bio || '').trim(),
    socialLinks: parsedSocials,
  };
}

/**
 * Fetches a single live user profile from the Supabase `profiles` table by ID,
 * caching results in memory to deduplicate concurrent card renders.
 */
export async function fetchProfileById(
  userId: string,
  forceRefresh = false
): Promise<LiveUserProfile | null> {
  const cleanId = (userId || '').trim();
  if (!cleanId) return null;

  if (!forceRefresh && profileCache.has(cleanId)) {
    return profileCache.get(cleanId) ?? null;
  }

  if (!isSupabaseConfigured()) {
    return null;
  }

  const existingInflight = inflightProfileRequests.get(cleanId);
  if (existingInflight && !forceRefresh) {
    return existingInflight;
  }

  const requestPromise = (async (): Promise<LiveUserProfile | null> => {
    try {
      // v21a: `profiles` is row-scoped (own row, admins, delegations). Fall back to the
      // safe `public_profiles` view so bylines/avatars keep working for everyone else.
      const { data: privateRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', cleanId)
        .maybeSingle();
      let data: unknown = privateRow;
      if (!data) {
        const { data: publicRow } = await supabase
          .from('public_profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq('id', cleanId)
          .maybeSingle();
        data = publicRow;
      }

      if (!data) {
        return null;
      }

      const mapped = mapRowToLiveProfile(data as SupabaseProfileRow);
      profileCache.set(cleanId, mapped);
      return mapped;
    } catch {
      return null;
    } finally {
      inflightProfileRequests.delete(cleanId);
    }
  })();

  inflightProfileRequests.set(cleanId, requestPromise);
  return requestPromise;
}

/**
 * Batch-fetches multiple user profiles from the Supabase `profiles` table
 * to enrich listing collections without N+1 queries.
 */
export async function fetchProfilesByIds(
  userIds: string[]
): Promise<Record<string, LiveUserProfile>> {
  const uniqueIds = Array.from(
    new Set(userIds.map((id) => (id || '').trim()).filter(Boolean))
  );
  const result: Record<string, LiveUserProfile> = {};

  if (uniqueIds.length === 0) {
    return result;
  }

  const missingIds: string[] = [];
  for (const id of uniqueIds) {
    const cached = profileCache.get(id);
    if (cached) {
      result[id] = cached;
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length === 0 || !isSupabaseConfigured()) {
    return result;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('id', missingIds);

    if (!error && Array.isArray(data)) {
      for (const rawRow of data) {
        const row = rawRow as SupabaseProfileRow;
        if (row?.id) {
          const mapped = mapRowToLiveProfile(row);
          profileCache.set(row.id, mapped);
          result[row.id] = mapped;
        }
      }
    }

    // v21a: rows hidden by the scoped `profiles` policy come from `public_profiles`
    const stillMissing = missingIds.filter((id) => !result[id]);
    if (stillMissing.length > 0) {
      const { data: publicRows, error: publicError } = await supabase
        .from('public_profiles')
        .select(PUBLIC_PROFILE_COLUMNS)
        .in('id', stillMissing);
      if (!publicError && Array.isArray(publicRows)) {
        for (const rawRow of publicRows) {
          const row = rawRow as SupabaseProfileRow;
          if (row?.id) {
            const mapped = mapRowToLiveProfile(row);
            profileCache.set(row.id, mapped);
            result[row.id] = mapped;
          }
        }
      }
    }
  } catch {
    // Gracefully return any cached profiles if table query fails
  }

  return result;
}

/**
 * Updates the user's `avatar_url` in the Supabase `profiles` table
 * and refreshes the live profile cache.
 */
export async function updateProfileAvatarUrl(
  userId: string,
  avatarUrl: string
): Promise<LiveUserProfile | null> {
  const cleanId = (userId || '').trim();
  const normalizedUrl = resolveRemoteMediaUrl(avatarUrl);
  if (!cleanId || !isSupabaseConfigured()) return null;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        avatar_url: normalizedUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cleanId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    const mapped = mapRowToLiveProfile(data as SupabaseProfileRow);
    profileCache.set(cleanId, mapped);
    return mapped;
  } catch {
    return null;
  }
}

/**
 * React hook used by `ListingCard` and `SelectedListingCard` to perform a live
 * secondary fetch (or resolve from join/cache) from the Supabase `profiles` table
 * so every listing displays its actual owner's live avatar and name.
 */
export function useLiveOwnerProfile(
  ownerId?: string,
  fallbackName?: string,
  fallbackAvatarUrl?: string
): {
  ownerName: string;
  ownerAvatarUrl: string;
  profile: LiveUserProfile | null;
  isLoading: boolean;
} {
  const cleanOwnerId = (ownerId || '').trim();
  const [profile, setProfile] = useState<LiveUserProfile | null>(() =>
    cleanOwnerId ? profileCache.get(cleanOwnerId) ?? null : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(cleanOwnerId && !profileCache.has(cleanOwnerId))
  );

  useEffect(() => {
    let active = true;

    if (!cleanOwnerId) {
      return () => {
        active = false;
      };
    }

    const cached = profileCache.get(cleanOwnerId);
    if (cached) {
      queueMicrotask(() => {
        if (active) {
          setProfile(cached);
          setIsLoading(false);
        }
      });
    } else {
      queueMicrotask(() => {
        if (active) {
          setIsLoading(true);
        }
      });
    }

    void fetchProfileById(cleanOwnerId).then((fetched) => {
      if (!active) return;
      if (fetched) {
        setProfile(fetched);
      }
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [cleanOwnerId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !cleanOwnerId) return;
    const handleProfileUpdated = () => {
      void fetchProfileById(cleanOwnerId, true).then((refreshed) => {
        if (refreshed) {
          setProfile(refreshed);
        }
      });
    };
    window.addEventListener('printswift:profile-updated', handleProfileUpdated);
    return () => {
      window.removeEventListener(
        'printswift:profile-updated',
        handleProfileUpdated
      );
    };
  }, [cleanOwnerId]);

  const sanitizedFallbackName = (() => {
    const raw = (fallbackName || '').trim();
    if (!raw || /^(demo|sample|placeholder)\b/i.test(raw)) {
      return 'Verified Owner';
    }
    return raw;
  })();

  const resolvedOwnerName = profile?.fullName || sanitizedFallbackName;
  const resolvedOwnerAvatarUrl =
    profile?.avatarUrl || resolveRemoteMediaUrl(fallbackAvatarUrl || '');

  return {
    ownerName: resolvedOwnerName,
    ownerAvatarUrl: resolvedOwnerAvatarUrl,
    profile,
    isLoading,
  };
}
