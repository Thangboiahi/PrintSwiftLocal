'use client';

import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { NotificationItem } from '@/lib/types';

export interface SupabaseNotificationRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface LiveNotificationRecord extends NotificationItem {
  user_id: string;
  is_read: boolean;
  created_at: string;
}

export interface SupabaseActivityLogRow {
  id: string;
  user_id: string;
  action_type: string;
  entity_id?: string | null;
  created_at: string;
}

export interface LiveActivityLogRecord {
  id: string;
  user_id: string;
  action_type: string;
  entity_id: string | null;
  created_at: string;
}

export function mapNotificationRow(
  row: SupabaseNotificationRow
): LiveNotificationRecord {
  const isRead = Boolean(row.is_read);
  const createdAt = row.created_at || new Date().toISOString();
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    recipientRole: 'owner',
    type: 'enquiry',
    title: String(row.title || 'Platform Notification'),
    message: String(row.message || ''),
    is_read: isRead,
    read: isRead,
    created_at: createdAt,
    createdAt,
  };
}

function mapActivityLogRow(row: SupabaseActivityLogRow): LiveActivityLogRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    action_type: String(row.action_type || 'activity'),
    entity_id: row.entity_id ? String(row.entity_id) : null,
    created_at: row.created_at || new Date().toISOString(),
  };
}

async function resolveCurrentAuthenticatedUserId(
  overrideUserId?: string
): Promise<string | null> {
  if (overrideUserId && overrideUserId.trim()) {
    return overrideUserId.trim();
  }
  if (!isSupabaseConfigured()) {
    return null;
  }
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user?.id) {
      return sessionData.session.user.id;
    }
    const { data: userData } = await supabase.auth.getUser();
    return userData?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches the authenticated user's live notifications from `public.notifications`.
 * Strips out all static/demo notifications and returns strictly database-backed rows.
 */
export async function fetchMyNotifications(
  userIdOverride?: string
): Promise<LiveNotificationRecord[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const userId = await resolveCurrentAuthenticatedUserId(userIdOverride);
  if (!userId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, title, message, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) {
      return [];
    }

    return (data as SupabaseNotificationRow[]).map(mapNotificationRow);
  } catch {
    return [];
  }
}

/**
 * Subscribes to real-time `INSERT` events on `public.notifications` where `user_id`
 * matches the currently authenticated user. Invokes `onInsert` immediately with the
 * normalized notification record and returns an unsubscribe cleanup callback.
 */
export function subscribeToMyNotifications(
  userId: string,
  onInsert: (notification: LiveNotificationRecord) => void
): () => void {
  const cleanUserId = (userId || '').trim();
  if (!cleanUserId || !isSupabaseConfigured()) {
    return () => {};
  }

  const channel = supabase
    .channel(`realtime-notifications-${cleanUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${cleanUserId}`,
      },
      (payload) => {
        const raw = payload.new as SupabaseNotificationRow | undefined;
        if (!raw || !raw.id) return;
        const mapped = mapNotificationRow(raw);
        onInsert(mapped);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('printswift:notifications-updated', {
              detail: { insertedNotification: mapped },
            })
          );
        }
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Marks a single notification as read (`is_read = true`) in `public.notifications`
 * and broadcasts a synchronization event so the global unread badge updates immediately.
 */
export async function markNotificationAsRead(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanId = (id || '').trim();
  if (!cleanId) {
    return { ok: false, error: 'Notification ID is required.' };
  }

  if (!isSupabaseConfigured()) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:notifications-updated', {
          detail: { markedReadId: cleanId },
        })
      );
    }
    return { ok: true };
  }

  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', cleanId);

    if (error) {
      return { ok: false, error: error.message };
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:notifications-updated', {
          detail: { markedReadId: cleanId },
        })
      );
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to mark notification as read.',
    };
  }
}

/**
 * Fetches the authenticated user's live activity logs from `public.activity_logs`.
 */
export async function fetchMyActivityLogs(
  userIdOverride?: string
): Promise<LiveActivityLogRecord[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const userId = await resolveCurrentAuthenticatedUserId(userIdOverride);
  if (!userId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, user_id, action_type, entity_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) {
      return [];
    }

    return (data as SupabaseActivityLogRow[]).map(mapActivityLogRow);
  } catch {
    return [];
  }
}

export async function fetchUserNotifications(
  userId: string
): Promise<LiveNotificationRecord[]> {
  const cleanUserId = (userId || '').trim();
  if (!cleanUserId || !isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, title, message, is_read, created_at')
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) {
      return [];
    }

    return (data as SupabaseNotificationRow[]).map(mapNotificationRow);
  } catch {
    return [];
  }
}

export async function fetchUserActivityLogs(
  userId: string
): Promise<LiveActivityLogRecord[]> {
  const cleanUserId = (userId || '').trim();
  if (!cleanUserId || !isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, user_id, action_type, entity_id, created_at')
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) {
      return [];
    }

    return (data as SupabaseActivityLogRow[]).map(mapActivityLogRow);
  } catch {
    return [];
  }
}
