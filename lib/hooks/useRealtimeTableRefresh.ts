'use client';

import { useEffect, useRef } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

/**
 * Lightweight Supabase Realtime (`postgres_changes`) auto-refresh hook.
 * Uses a unique channel instance per mount and cleanly removes the channel on unmount.
 */
export function useRealtimeTableRefresh(
  table: string,
  onRefresh: () => void,
  options?: {
    enabled?: boolean;
    filter?: string;
    debounceMs?: number;
  }
) {
  const enabled = options?.enabled !== false;
  const filter = options?.filter;
  const debounceMs = options?.debounceMs ?? 400;

  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || !table || !isSupabaseConfigured()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const channelId = `rt-${table}-${Math.random().toString(36).slice(2, 10)}`;

    const channel = supabase.channel(channelId);
    try {
      channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            ...(filter ? { filter } : {}),
          },
          () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              refreshRef.current();
            }, debounceMs);
          }
        )
        .subscribe();
    } catch {
      // Non-blocking fallback when Realtime is unavailable
    }

    return () => {
      if (timer) clearTimeout(timer);
      try {
        void supabase.removeChannel(channel);
      } catch {
        // ignore cleanup error
      }
    };
  }, [table, filter, enabled, debounceMs]);
}
