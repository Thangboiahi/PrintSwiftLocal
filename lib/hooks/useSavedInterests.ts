'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/store';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { emitBookmarkChange } from '@/lib/events';

export type SavedItemType = 'listing' | 'product' | 'bulletin' | 'vehicle';
export type FollowTargetType = 'shop_listing' | 'author';
export type InterestType = 'category' | 'locality' | 'bulletin_tag';

export interface SavedItemRecord {
  id?: string;
  item_type: SavedItemType;
  item_id: string;
  created_at?: string;
}

export interface FollowRecord {
  id?: string;
  target_type: FollowTargetType;
  target_id: string;
  created_at?: string;
}

export interface InterestRecord {
  id?: string;
  interest_type: InterestType;
  interest_value: string;
  hub_id?: string | null;
  locality_id?: string | null;
  category_id?: string | null;
  created_at?: string;
}

export interface ToggleInterestMeta {
  hubId?: string | null;
  localityId?: string | null;
  categoryId?: string | null;
}

interface SavedInterestsStoreSnapshot {
  savedItems: SavedItemRecord[];
  follows: FollowRecord[];
  interests: InterestRecord[];
  loading: boolean;
  loadedScopeKey: string | null;
}

interface PersistedGuestPayload {
  savedItems: SavedItemRecord[];
  follows: FollowRecord[];
  interests: InterestRecord[];
}

export const STORAGE_KEY_SAVED_INTERESTS = 'printswift_saved_interests_v1';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INITIAL_SERVER_SNAPSHOT: SavedInterestsStoreSnapshot = Object.freeze({
  savedItems: [],
  follows: [],
  interests: [],
  loading: false,
  loadedScopeKey: null,
});

const listeners = new Set<() => void>();
let currentState: SavedInterestsStoreSnapshot = INITIAL_SERVER_SNAPSHOT;
let activeLoadScope: string | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function setState(next: SavedInterestsStoreSnapshot) {
  currentState = next;
  notify();
}

function readLocalPayload(): PersistedGuestPayload {
  if (typeof window === 'undefined') {
    return { savedItems: [], follows: [], interests: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SAVED_INTERESTS);
    if (!raw) return { savedItems: [], follows: [], interests: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedGuestPayload>;
    const savedItems = Array.isArray(parsed.savedItems)
      ? parsed.savedItems.filter(
          (row): row is SavedItemRecord =>
            Boolean(row) &&
            (row.item_type === 'listing' ||
              row.item_type === 'product' ||
              row.item_type === 'bulletin' ||
              row.item_type === 'vehicle') &&
            typeof row.item_id === 'string' &&
            row.item_id.trim().length > 0
        )
      : [];
    const follows = Array.isArray(parsed.follows)
      ? parsed.follows.filter(
          (row): row is FollowRecord =>
            Boolean(row) &&
            (row.target_type === 'shop_listing' ||
              row.target_type === 'author') &&
            typeof row.target_id === 'string' &&
            row.target_id.trim().length > 0
        )
      : [];
    const interests = Array.isArray(parsed.interests)
      ? parsed.interests.filter(
          (row): row is InterestRecord =>
            Boolean(row) &&
            (row.interest_type === 'category' ||
              row.interest_type === 'locality' ||
              row.interest_type === 'bulletin_tag') &&
            typeof row.interest_value === 'string' &&
            row.interest_value.trim().length > 0
        )
      : [];
    return { savedItems, follows, interests };
  } catch {
    return { savedItems: [], follows: [], interests: [] };
  }
}

function writeLocalPayload(payload: PersistedGuestPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY_SAVED_INTERESTS,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore storage quota errors
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): SavedInterestsStoreSnapshot {
  return currentState;
}

function getServerSnapshot(): SavedInterestsStoreSnapshot {
  return INITIAL_SERVER_SNAPSHOT;
}

async function hydrateForScope(
  authUserId: string,
  force = false
): Promise<void> {
  const scopeKey =
    authUserId && isSupabaseConfigured() ? `user:${authUserId}` : 'guest';

  if (!force && (currentState.loadedScopeKey === scopeKey || activeLoadScope === scopeKey)) {
    return;
  }

  activeLoadScope = scopeKey;

  if (scopeKey === 'guest') {
    const local = readLocalPayload();
    activeLoadScope = null;
    setState({
      savedItems: local.savedItems,
      follows: local.follows,
      interests: local.interests,
      loading: false,
      loadedScopeKey: scopeKey,
    });
    return;
  }

  setState({
    ...currentState,
    loading: true,
  });

  try {
    const [savedRes, followsRes, interestsRes] = await Promise.all([
      supabase
        .from('user_saved_items')
        .select('id, item_type, item_id, created_at')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_follows')
        .select('id, target_type, target_id, created_at')
        .eq('follower_id', authUserId)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_interests')
        .select('id, interest_type, interest_value, hub_id, locality_id, category_id, created_at')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false }),
    ]);

    let finalInterestsData: unknown[] | null = interestsRes.data;
    if (interestsRes.error) {
      const fallbackRes = await supabase
        .from('user_interests')
        .select('id, interest_type, interest_value, created_at')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false });
      finalInterestsData = fallbackRes.data;
    }

    // Guard against stale async responses if user signed out/switched mid-flight
    if (activeLoadScope !== scopeKey) return;

    const savedItems = (savedRes.data || []) as SavedItemRecord[];
    const follows = (followsRes.data || []) as FollowRecord[];
    const interests = (finalInterestsData || []) as InterestRecord[];

    writeLocalPayload({ savedItems, follows, interests });
    setState({
      savedItems,
      follows,
      interests,
      loading: false,
      loadedScopeKey: scopeKey,
    });
  } catch {
    if (activeLoadScope !== scopeKey) return;
    const fallback = readLocalPayload();
    setState({
      savedItems: fallback.savedItems,
      follows: fallback.follows,
      interests: fallback.interests,
      loading: false,
      loadedScopeKey: scopeKey,
    });
  } finally {
    if (activeLoadScope === scopeKey) {
      activeLoadScope = null;
    }
  }
}

export interface UseSavedInterestsResult {
  savedItems: SavedItemRecord[];
  follows: FollowRecord[];
  interests: InterestRecord[];
  loading: boolean;
  isGuest: boolean;
  savedCounts: {
    total: number;
    listing: number;
    product: number;
    bulletin: number;
    vehicle: number;
  };
  isSaved: (type: SavedItemType, id: string) => boolean;
  toggleSave: (type: SavedItemType, id: string) => Promise<boolean>;
  isFollowing: (targetType: FollowTargetType, targetId: string) => boolean;
  toggleFollow: (
    targetType: FollowTargetType,
    targetId: string
  ) => Promise<boolean>;
  hasInterest: (interestType: InterestType, interestValue: string) => boolean;
  toggleInterest: (
    interestType: InterestType,
    interestValue: string,
    meta?: ToggleInterestMeta
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Phase 62-A: Unified Saved, Follows & Interests Client Hook
 * - Shares a deduplicated reactive store across all mounted components.
 * - Uses Supabase (`user_saved_items`, `user_follows`, `user_interests`) when signed in,
 *   with optimistic UI updates + rollback on error.
 * - Automatically falls back to `localStorage` for unauthenticated guests.
 * - Triggers `useAppStatus('saving')` -> `'success'` (or `'error'`) on every mutation.
 */
export function useSavedInterests(): UseSavedInterestsResult {
  const { user: authUser } = useAuth();
  const authUserId = authUser?.id || '';
  const { setStatus } = useAppStatus();

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    void hydrateForScope(authUserId, false);
  }, [authUserId]);

  const savedKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const item of snapshot.savedItems) {
      set.add(`${item.item_type}:${item.item_id}`);
    }
    return set;
  }, [snapshot.savedItems]);

  const followKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const row of snapshot.follows) {
      set.add(`${row.target_type}:${row.target_id}`);
    }
    return set;
  }, [snapshot.follows]);

  const interestKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const row of snapshot.interests) {
      set.add(`${row.interest_type}:${row.interest_value.trim().toLowerCase()}`);
    }
    return set;
  }, [snapshot.interests]);

  const savedCounts = useMemo(() => {
    let listing = 0;
    let product = 0;
    let bulletin = 0;
    let vehicle = 0;
    for (const item of snapshot.savedItems) {
      if (item.item_type === 'listing') listing += 1;
      else if (item.item_type === 'product') product += 1;
      else if (item.item_type === 'bulletin') bulletin += 1;
      else if (item.item_type === 'vehicle') vehicle += 1;
    }
    return {
      total: snapshot.savedItems.length,
      listing,
      product,
      bulletin,
      vehicle,
    };
  }, [snapshot.savedItems]);

  const isSaved = useCallback(
    (type: SavedItemType, id: string): boolean => {
      if (!id) return false;
      return savedKeySet.has(`${type}:${id}`);
    },
    [savedKeySet]
  );

  const isFollowing = useCallback(
    (targetType: FollowTargetType, targetId: string): boolean => {
      if (!targetId) return false;
      return followKeySet.has(`${targetType}:${targetId}`);
    },
    [followKeySet]
  );

  const hasInterest = useCallback(
    (interestType: InterestType, interestValue: string): boolean => {
      const normalized = interestValue.trim().toLowerCase();
      if (!normalized) return false;
      return interestKeySet.has(`${interestType}:${normalized}`);
    },
    [interestKeySet]
  );

  const toggleSave = useCallback(
    async (type: SavedItemType, id: string): Promise<boolean> => {
      const cleanId = id.trim();
      if (!cleanId) return false;

      const prevState = currentState;
      const alreadySaved = prevState.savedItems.some(
        (item) => item.item_type === type && item.item_id === cleanId
      );
      const nextSaved = !alreadySaved;

      const nextSavedItems: SavedItemRecord[] = alreadySaved
        ? prevState.savedItems.filter(
            (item) => !(item.item_type === type && item.item_id === cleanId)
          )
        : [
            {
              item_type: type,
              item_id: cleanId,
              created_at: new Date().toISOString(),
            },
            ...prevState.savedItems,
          ];

      // Optimistic update
      setState({
        ...prevState,
        savedItems: nextSavedItems,
      });
      writeLocalPayload({
        savedItems: nextSavedItems,
        follows: prevState.follows,
        interests: prevState.interests,
      });
      setStatus('saving');

      const canPersistRemote =
        Boolean(authUserId) &&
        isSupabaseConfigured() &&
        UUID_REGEX.test(cleanId);

      if (!canPersistRemote) {
        if (type === 'listing') emitBookmarkChange();
        setStatus('success', nextSaved ? 'Saved' : 'Removed');
        return nextSaved;
      }

      try {
        if (nextSaved) {
          const { error } = await supabase.from('user_saved_items').upsert(
            {
              user_id: authUserId,
              item_type: type,
              item_id: cleanId,
            },
            { onConflict: 'user_id,item_type,item_id' }
          );
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('user_saved_items')
            .delete()
            .eq('user_id', authUserId)
            .eq('item_type', type)
            .eq('item_id', cleanId);
          if (error) throw error;
        }

        if (type === 'listing') emitBookmarkChange();
        setStatus('success', nextSaved ? 'Saved' : 'Removed');
        return nextSaved;
      } catch {
        // Roll back optimistic state on database failure
        setState(prevState);
        writeLocalPayload({
          savedItems: prevState.savedItems,
          follows: prevState.follows,
          interests: prevState.interests,
        });
        setStatus('error', 'Could not save');
        return alreadySaved;
      }
    },
    [authUserId, setStatus]
  );

  const toggleFollow = useCallback(
    async (
      targetType: FollowTargetType,
      targetId: string
    ): Promise<boolean> => {
      const cleanId = targetId.trim();
      if (!cleanId) return false;

      const prevState = currentState;
      const alreadyFollowing = prevState.follows.some(
        (row) => row.target_type === targetType && row.target_id === cleanId
      );
      const nextFollowing = !alreadyFollowing;

      const nextFollows: FollowRecord[] = alreadyFollowing
        ? prevState.follows.filter(
            (row) =>
              !(row.target_type === targetType && row.target_id === cleanId)
          )
        : [
            {
              target_type: targetType,
              target_id: cleanId,
              created_at: new Date().toISOString(),
            },
            ...prevState.follows,
          ];

      setState({
        ...prevState,
        follows: nextFollows,
      });
      writeLocalPayload({
        savedItems: prevState.savedItems,
        follows: nextFollows,
        interests: prevState.interests,
      });
      setStatus('saving');

      const canPersistRemote =
        Boolean(authUserId) &&
        isSupabaseConfigured() &&
        UUID_REGEX.test(cleanId);

      if (!canPersistRemote) {
        setStatus('success', nextFollowing ? 'Following' : 'Unfollowed');
        return nextFollowing;
      }

      try {
        if (nextFollowing) {
          const { error } = await supabase.from('user_follows').upsert(
            {
              follower_id: authUserId,
              target_type: targetType,
              target_id: cleanId,
            },
            { onConflict: 'follower_id,target_type,target_id' }
          );
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('user_follows')
            .delete()
            .eq('follower_id', authUserId)
            .eq('target_type', targetType)
            .eq('target_id', cleanId);
          if (error) throw error;
        }

        setStatus('success', nextFollowing ? 'Following' : 'Unfollowed');
        return nextFollowing;
      } catch {
        setState(prevState);
        writeLocalPayload({
          savedItems: prevState.savedItems,
          follows: prevState.follows,
          interests: prevState.interests,
        });
        setStatus('error', 'Follow failed');
        return alreadyFollowing;
      }
    },
    [authUserId, setStatus]
  );

  const toggleInterest = useCallback(
    async (
      interestType: InterestType,
      interestValue: string,
      meta?: ToggleInterestMeta
    ): Promise<boolean> => {
      const cleanValue = interestValue.trim();
      if (!cleanValue) return false;
      const lowerValue = cleanValue.toLowerCase();

      const validHubId =
        meta?.hubId && UUID_REGEX.test(meta.hubId) ? meta.hubId : null;
      const validLocalityId =
        meta?.localityId && UUID_REGEX.test(meta.localityId)
          ? meta.localityId
          : null;
      const validCategoryId =
        meta?.categoryId && UUID_REGEX.test(meta.categoryId)
          ? meta.categoryId
          : null;

      const prevState = currentState;
      const existingRow = prevState.interests.find(
        (row) =>
          row.interest_type === interestType &&
          row.interest_value.trim().toLowerCase() === lowerValue
      );
      const nextActive = !existingRow;

      const nextInterests: InterestRecord[] = existingRow
        ? prevState.interests.filter(
            (row) =>
              !(
                row.interest_type === interestType &&
                row.interest_value.trim().toLowerCase() === lowerValue
              )
          )
        : [
            {
              interest_type: interestType,
              interest_value: cleanValue,
              hub_id: validHubId,
              locality_id: validLocalityId,
              category_id: validCategoryId,
              created_at: new Date().toISOString(),
            },
            ...prevState.interests,
          ];

      setState({
        ...prevState,
        interests: nextInterests,
      });
      writeLocalPayload({
        savedItems: prevState.savedItems,
        follows: prevState.follows,
        interests: nextInterests,
      });
      setStatus('saving');

      const canPersistRemote = Boolean(authUserId) && isSupabaseConfigured();

      if (!canPersistRemote) {
        setStatus('success', nextActive ? 'Tracked' : 'Removed');
        return nextActive;
      }

      try {
        if (nextActive) {
          const payloadWithMeta: Record<string, unknown> = {
            user_id: authUserId,
            interest_type: interestType,
            interest_value: cleanValue,
            ...(validHubId ? { hub_id: validHubId } : {}),
            ...(validLocalityId ? { locality_id: validLocalityId } : {}),
            ...(validCategoryId ? { category_id: validCategoryId } : {}),
          };
          const { error } = await supabase
            .from('user_interests')
            .upsert(payloadWithMeta, {
              onConflict: 'user_id,interest_type,interest_value',
            });
          if (error) {
            const { error: fallbackError } = await supabase
              .from('user_interests')
              .upsert(
                {
                  user_id: authUserId,
                  interest_type: interestType,
                  interest_value: cleanValue,
                },
                { onConflict: 'user_id,interest_type,interest_value' }
              );
            if (fallbackError) throw fallbackError;
          }
        } else {
          const { error } = await supabase
            .from('user_interests')
            .delete()
            .eq('user_id', authUserId)
            .eq('interest_type', interestType)
            .eq('interest_value', existingRow.interest_value);
          if (error) throw error;
        }

        setStatus('success', nextActive ? 'Tracked' : 'Removed');
        return nextActive;
      } catch {
        setState(prevState);
        writeLocalPayload({
          savedItems: prevState.savedItems,
          follows: prevState.follows,
          interests: prevState.interests,
        });
        setStatus('error', 'Update failed');
        return Boolean(existingRow);
      }
    },
    [authUserId, setStatus]
  );

  const refresh = useCallback(async () => {
    await hydrateForScope(authUserId, true);
  }, [authUserId]);

  return {
    savedItems: snapshot.savedItems,
    follows: snapshot.follows,
    interests: snapshot.interests,
    loading: snapshot.loading,
    isGuest: !authUserId,
    savedCounts,
    isSaved,
    toggleSave,
    isFollowing,
    toggleFollow,
    hasInterest,
    toggleInterest,
    refresh,
  };
}

export default useSavedInterests;
