'use client';

import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { NotificationItem } from '@/lib/types';

export type NotificationCategory =
  | 'orders_bookings'
  | 'logistics_escrow'
  | 'enquiries_reviews'
  | 'moderation_kyc'
  | 'billing_trials'
  | 'team_staff'
  | 'system';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationRoleScope =
  | 'visitor'
  | 'owner'
  | 'staff'
  | 'driver'
  | 'mediator'
  | 'hub_manager'
  | 'advertiser'
  | 'super_admin';

export interface NotificationCategoryMeta {
  id: NotificationCategory;
  chipLabel: string;
  settingsTitle: string;
  settingsDescription: string;
}

export const NOTIFICATION_CATEGORIES_META: readonly NotificationCategoryMeta[] = [
  {
    id: 'orders_bookings',
    chipLabel: 'Orders',
    settingsTitle: 'Orders, Bookings & Print Quotes',
    settingsDescription:
      'Shop orders, restaurant orders, turf/hotel resource bookings, and print job quotes or status updates.',
  },
  {
    id: 'logistics_escrow',
    chipLabel: 'Logistics & Escrow',
    settingsTitle: 'Pick N Drop & Vehicle Escrow',
    settingsDescription:
      'Driver assignments, scheduled vehicle seat/charter confirmations, and trip milestones (urgent OTP & dispute alerts stay always-on).',
  },
  {
    id: 'enquiries_reviews',
    chipLabel: 'Enquiries',
    settingsTitle: 'Enquiries, Reviews & Property Visits',
    settingsDescription:
      'Customer listing enquiries, review replies, and real-estate site visit approvals & contact unlocks.',
  },
  {
    id: 'moderation_kyc',
    chipLabel: 'Moderation',
    settingsTitle: 'Moderation, KYC & Suggested Categories',
    settingsDescription:
      'Directory listing verifications, bulletin approvals, partner KYC decisions, and L3 category reviews.',
  },
  {
    id: 'billing_trials',
    chipLabel: 'Billing',
    settingsTitle: 'Billing, Plans & Pay-Per Promotions',
    settingsDescription:
      'Subscription renewals, trial expiry reminders, and pay-per promotion payment verifications.',
  },
  {
    id: 'team_staff',
    chipLabel: 'Team',
    settingsTitle: 'Team & Staff Delegations',
    settingsDescription:
      'Staff workspace invitations, role delegation updates, and operator queue handoffs.',
  },
] as const;

export interface NotificationPreferences {
  push_enabled: boolean;
  email_enabled: boolean;
  orders_bookings: boolean;
  logistics_escrow: boolean;
  enquiries_reviews: boolean;
  moderation_kyc: boolean;
  billing_trials: boolean;
  team_staff: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  push_enabled: true,
  email_enabled: true,
  orders_bookings: true,
  logistics_escrow: true,
  enquiries_reviews: true,
  moderation_kyc: true,
  billing_trials: true,
  team_staff: true,
};

export function normalizeNotificationPreferences(
  raw: unknown
): NotificationPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
  const obj = raw as Record<string, unknown>;
  const nested =
    obj.categories &&
    typeof obj.categories === 'object' &&
    !Array.isArray(obj.categories)
      ? (obj.categories as Record<string, unknown>)
      : {};
  const mutedList = Array.isArray(obj.muted_categories)
    ? new Set(obj.muted_categories.map((v) => String(v)))
    : new Set<string>();

  const readBool = (key: keyof NotificationPreferences): boolean => {
    if (mutedList.has(key)) return false;
    if (typeof obj[key] === 'boolean') return obj[key] as boolean;
    if (typeof nested[key] === 'boolean') return nested[key] as boolean;
    return DEFAULT_NOTIFICATION_PREFERENCES[key];
  };

  return {
    push_enabled: readBool('push_enabled'),
    email_enabled: readBool('email_enabled'),
    orders_bookings: readBool('orders_bookings'),
    logistics_escrow: readBool('logistics_escrow'),
    enquiries_reviews: readBool('enquiries_reviews'),
    moderation_kyc: readBool('moderation_kyc'),
    billing_trials: readBool('billing_trials'),
    team_staff: readBool('team_staff'),
  };
}

export interface SupabaseNotificationRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  read?: boolean | null;
  type?: string | null;
  category?: string | null;
  priority?: string | null;
  role_scope?: string | null;
  action_url?: string | null;
  link_listing_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface LiveNotificationRecord extends NotificationItem {
  user_id: string;
  is_read: boolean;
  category: NotificationCategory;
  priority: NotificationPriority;
  role_scope: NotificationRoleScope;
  action_url?: string | null;
  link_listing_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface SupabaseActivityLogRow {
  id: string;
  user_id?: string;
  source?: string | null;
  action_type: string;
  entity_id?: string | null;
  entity_title?: string | null;
  workspace?: string | null;
  details?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface LiveActivityLogRecord {
  id: string;
  user_id: string;
  source: 'activity_log' | 'audit_log';
  action_type: string;
  entity_id: string | null;
  entity_title: string;
  workspace: string;
  details: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function normalizeNotificationCategory(
  rawCategory?: string | null,
  rawType?: string | null,
  title?: string | null,
  message?: string | null
): NotificationCategory {
  const cat = String(rawCategory || '').trim().toLowerCase();
  if (
    cat === 'orders_bookings' ||
    cat === 'logistics_escrow' ||
    cat === 'enquiries_reviews' ||
    cat === 'moderation_kyc' ||
    cat === 'billing_trials' ||
    cat === 'team_staff' ||
    cat === 'system'
  ) {
    return cat;
  }

  const hay = `${rawType || ''} ${title || ''} ${message || ''}`.toLowerCase();
  if (
    hay.includes('pick n drop') ||
    hay.includes('delivery') ||
    hay.includes('escrow') ||
    hay.includes('driver') ||
    hay.includes('vehicle')
  ) {
    return 'logistics_escrow';
  }
  if (
    hay.includes('order') ||
    hay.includes('booking') ||
    hay.includes('print') ||
    hay.includes('kitchen') ||
    hay.includes('table')
  ) {
    return 'orders_bookings';
  }
  if (
    hay.includes('enquiry') ||
    hay.includes('review') ||
    hay.includes('visit') ||
    hay.includes('property')
  ) {
    return 'enquiries_reviews';
  }
  if (
    hay.includes('kyc') ||
    hay.includes('verification') ||
    hay.includes('moderation') ||
    hay.includes('approved') ||
    hay.includes('rejected') ||
    hay.includes('category')
  ) {
    return 'moderation_kyc';
  }
  if (
    hay.includes('subscription') ||
    hay.includes('plan') ||
    hay.includes('pay-per') ||
    hay.includes('trial') ||
    hay.includes('payment')
  ) {
    return 'billing_trials';
  }
  if (hay.includes('staff') || hay.includes('delegation') || hay.includes('team')) {
    return 'team_staff';
  }
  return 'system';
}

export function normalizeNotificationPriority(
  rawPriority?: string | null
): NotificationPriority {
  const p = String(rawPriority || '').trim().toLowerCase();
  if (p === 'low' || p === 'normal' || p === 'high' || p === 'urgent') {
    return p;
  }
  return 'normal';
}

export function normalizeNotificationRoleScope(
  rawRole?: string | null
): NotificationRoleScope {
  const r = String(rawRole || '').trim().toLowerCase();
  if (
    r === 'visitor' ||
    r === 'owner' ||
    r === 'staff' ||
    r === 'driver' ||
    r === 'mediator' ||
    r === 'hub_manager' ||
    r === 'advertiser' ||
    r === 'super_admin'
  ) {
    return r;
  }
  return 'visitor';
}

export function formatRelativeIstTime(iso: string): string {
  if (!iso) return 'Just now';
  const date = new Date(iso);
  const ts = date.getTime();
  if (Number.isNaN(ts)) return iso.slice(0, 10);

  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins}m ago`;
  }
  if (diffSec < 86400) {
    const hrs = Math.max(1, Math.floor(diffSec / 3600));
    return `${hrs}h ago`;
  }
  if (diffSec < 86400 * 7) {
    const days = Math.max(1, Math.floor(diffSec / 86400));
    return `${days}d ago`;
  }
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function resolveNotificationActionUrl(
  row: Pick<SupabaseNotificationRow, 'action_url' | 'metadata' | 'title' | 'message'>
): string {
  if (
    typeof row.action_url === 'string' &&
    row.action_url.trim().startsWith('/') &&
    !row.action_url.trim().startsWith('//')
  ) {
    return row.action_url.trim();
  }
  const metaUrl =
    row.metadata && typeof row.metadata.action_url === 'string'
      ? row.metadata.action_url.trim()
      : '';
  if (metaUrl.startsWith('/') && !metaUrl.startsWith('//')) {
    return metaUrl;
  }
  const hay = `${row.title || ''} ${row.message || ''}`.toLowerCase();
  if (hay.includes('print')) return '/activity?tab=print';
  if (hay.includes('booking') || hay.includes('turf') || hay.includes('hotel')) {
    return '/activity?tab=bookings';
  }
  if (
    hay.includes('restaurant') ||
    hay.includes('kitchen') ||
    hay.includes('shop') ||
    hay.includes('table')
  ) {
    return '/activity?tab=commerce';
  }
  if (hay.includes('visit') || hay.includes('property') || hay.includes('enquiry')) {
    return '/activity?tab=enquiries';
  }
  if (hay.includes('hub') || hay.includes('civic')) {
    return '/workspace/hub';
  }
  return '/activity';
}

function toNotificationItemType(
  raw: string | null | undefined
): NotificationItem['type'] {
  const value = String(raw || '').toLowerCase();
  if (value === 'review') return 'review';
  if (
    value === 'verification' ||
    value.includes('kyc') ||
    value.includes('approved') ||
    value.includes('rejected')
  ) {
    return 'verification';
  }
  if (value === 'reminder') return 'reminder';
  if (value === 'enquiry') return 'enquiry';
  return 'status_change';
}

export function mapNotificationRow(
  row: SupabaseNotificationRow
): LiveNotificationRecord {
  const isRead = Boolean(row.is_read ?? row.read);
  const createdAt = row.created_at || new Date().toISOString();
  const category = normalizeNotificationCategory(
    row.category,
    row.type,
    row.title,
    row.message
  );
  const priority = normalizeNotificationPriority(row.priority);
  const roleScope = normalizeNotificationRoleScope(row.role_scope);

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    recipientRole:
      roleScope === 'super_admin' || roleScope === 'hub_manager'
        ? 'admin'
        : 'owner',
    type: toNotificationItemType(row.type),
    category,
    priority,
    role_scope: roleScope,
    title: String(row.title || 'Platform Notification'),
    message: String(row.message || ''),
    is_read: isRead,
    read: isRead,
    action_url: resolveNotificationActionUrl(row),
    link_listing_id: row.link_listing_id ?? null,
    metadata:
      row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
    created_at: createdAt,
    createdAt,
  };
}

function mapActivityLogRow(
  row: SupabaseActivityLogRow,
  fallbackUserId = ''
): LiveActivityLogRecord {
  const actionType = String(row.action_type || 'activity');
  const defaultLabel = actionType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const meta =
    row.metadata && typeof row.metadata === 'object' ? row.metadata : null;
  const entityTitle = String(
    row.entity_title ||
      (meta && typeof meta.entity_title === 'string' ? meta.entity_title : '') ||
      (meta && typeof meta.title === 'string' ? meta.title : '') ||
      defaultLabel
  );
  const details = String(
    row.details ||
      (meta && typeof meta.details === 'string' ? meta.details : '') ||
      (meta && typeof meta.code === 'string' ? `Ref: ${meta.code}` : '') ||
      defaultLabel
  );

  return {
    id: String(row.id),
    user_id: String(row.user_id || fallbackUserId),
    source: row.source === 'audit_log' ? 'audit_log' : 'activity_log',
    action_type: actionType,
    entity_id: row.entity_id ? String(row.entity_id) : null,
    entity_title: entityTitle,
    workspace: String(
      row.workspace ||
        (meta && typeof meta.workspace === 'string' ? meta.workspace : 'personal')
    ),
    details,
    metadata: meta,
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

const NOTIFICATION_SELECT_COLUMNS =
  'id, user_id, title, message, is_read, type, category, priority, role_scope, action_url, link_listing_id, metadata, created_at';

const NOTIFICATION_SELECT_FALLBACK_COLUMNS =
  'id, user_id, title, message, is_read, type, action_url, metadata, created_at';

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

  return fetchUserNotifications(userId);
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
      .select(NOTIFICATION_SELECT_COLUMNS)
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: false })
      .limit(80);

    if (!error && Array.isArray(data)) {
      return (data as SupabaseNotificationRow[]).map(mapNotificationRow);
    }

    const { data: fallbackData, error: fallbackErr } = await supabase
      .from('notifications')
      .select(NOTIFICATION_SELECT_FALLBACK_COLUMNS)
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: false })
      .limit(80);

    if (fallbackErr || !Array.isArray(fallbackData)) {
      return [];
    }

    return (fallbackData as SupabaseNotificationRow[]).map(mapNotificationRow);
  } catch {
    return [];
  }
}

export function subscribeToMyNotifications(
  userId: string,
  onInsert: (notification: LiveNotificationRecord) => void,
  onUpdate?: (notification: LiveNotificationRecord) => void
): () => void {
  const cleanUserId = (userId || '').trim();
  if (!cleanUserId || !isSupabaseConfigured()) {
    return () => {};
  }

  let channel: ReturnType<typeof supabase.channel> | null = null;

  try {
    const channelName = `realtime-notifications-${cleanUserId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    if (typeof supabase.getChannels === 'function') {
      supabase.getChannels().forEach((ch) => {
        if (ch.topic.includes(channelName)) {
          void supabase.removeChannel(ch);
        }
      });
    }

    channel = supabase
      .channel(channelName)
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
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${cleanUserId}`,
        },
        (payload) => {
          const raw = payload.new as SupabaseNotificationRow | undefined;
          if (!raw || !raw.id) return;
          const mapped = mapNotificationRow(raw);
          onUpdate?.(mapped);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('printswift:notifications-updated', {
                detail: { updatedNotification: mapped },
              })
            );
          }
        }
      )
      .subscribe();
  } catch {
    channel = null;
  }

  return () => {
    if (channel) {
      try {
        void supabase.removeChannel(channel);
      } catch {
        // Ignore cleanup errors on already-removed channels
      }
    }
  };
}

export async function markNotificationsRead(options?: {
  ids?: string[];
  category?: NotificationCategory | 'all' | null;
  userIdOverride?: string;
}): Promise<{ ok: boolean; updatedCount?: number; error?: string }> {
  const ids =
    options?.ids && options.ids.length > 0
      ? options.ids.map((id) => id.trim()).filter(Boolean)
      : null;
  const category =
    options?.category && options.category !== 'all' ? options.category : null;

  if (!isSupabaseConfigured()) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:notifications-updated', {
          detail: ids?.length === 1 ? { markedReadId: ids[0] } : { markedAllRead: true },
        })
      );
    }
    return { ok: true, updatedCount: ids?.length ?? 0 };
  }

  try {
    const { data, error } = await supabase.rpc('mark_notifications_read', {
      p_notification_ids: ids,
      p_category: category,
    });

    if (!error) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('printswift:notifications-updated', {
            detail:
              ids?.length === 1
                ? { markedReadId: ids[0] }
                : { markedAllRead: true, category },
          })
        );
      }
      return { ok: true, updatedCount: Number(data ?? 0) };
    }

    // Fallback direct table update if RPC hasn't been applied on target DB yet
    const userId = await resolveCurrentAuthenticatedUserId(
      options?.userIdOverride
    );
    if (!userId) {
      return { ok: false, error: 'Authentication required.' };
    }

    let query = supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (ids && ids.length > 0) {
      query = query.in('id', ids);
    }
    if (category) {
      query = query.eq('category', category);
    }

    const { error: fallbackError } = await query;
    if (fallbackError) {
      return { ok: false, error: fallbackError.message };
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:notifications-updated', {
          detail:
            ids?.length === 1
              ? { markedReadId: ids[0] }
              : { markedAllRead: true, category },
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
          : 'Failed to mark notifications as read.',
    };
  }
}

export async function markNotificationAsRead(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanId = (id || '').trim();
  if (!cleanId) {
    return { ok: false, error: 'Notification ID is required.' };
  }
  return markNotificationsRead({ ids: [cleanId] });
}

export async function markAllNotificationsAsRead(
  userIdOverride?: string,
  category?: NotificationCategory | 'all' | null
): Promise<{ ok: boolean; error?: string }> {
  return markNotificationsRead({
    userIdOverride,
    category: category ?? null,
  });
}

/**
 * Fetches the authenticated user's merged chronological activity feed via
 * `get_my_activity_feed(p_limit, p_workspace)` (combining `activity_logs` and
 * the caller's own role-scoped `audit_logs` actions), falling back cleanly to
 * `public.activity_logs`.
 */
export async function fetchMyActivityLogs(
  userIdOverride?: string,
  options?: { limit?: number; workspace?: string | null }
): Promise<LiveActivityLogRecord[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const userId = await resolveCurrentAuthenticatedUserId(userIdOverride);
  if (!userId) {
    return [];
  }

  const limit = options?.limit ?? 35;
  const workspace = options?.workspace ?? null;

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_my_activity_feed',
      {
        p_limit: limit,
        p_workspace: workspace,
      }
    );

    if (!rpcError && Array.isArray(rpcData)) {
      return (rpcData as SupabaseActivityLogRow[]).map((row) =>
        mapActivityLogRow(row, userId)
      );
    }
  } catch {
    // Fallback to direct table select below
  }

  return fetchUserActivityLogs(userId, limit);
}

export async function fetchUserActivityLogs(
  userId: string,
  limit = 35
): Promise<LiveActivityLogRecord[]> {
  const cleanUserId = (userId || '').trim();
  if (!cleanUserId || !isSupabaseConfigured()) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, user_id, action_type, entity_id, entity_title, metadata, created_at')
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error && Array.isArray(data)) {
      return (data as SupabaseActivityLogRow[]).map((r) =>
        mapActivityLogRow(r, cleanUserId)
      );
    }

    const { data: fallbackData, error: fallbackError } = await supabase
      .from('activity_logs')
      .select('id, user_id, action_type, entity_id, created_at')
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (fallbackError || !Array.isArray(fallbackData)) {
      return [];
    }

    return (fallbackData as SupabaseActivityLogRow[]).map((r) =>
      mapActivityLogRow(r, cleanUserId)
    );
  } catch {
    return [];
  }
}

export async function fetchMyNotificationPreferences(
  userIdOverride?: string
): Promise<NotificationPreferences> {
  if (!isSupabaseConfigured()) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
  const userId = await resolveCurrentAuthenticatedUserId(userIdOverride);
  if (!userId) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('notification_preferences')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    return normalizeNotificationPreferences(
      (data as { notification_preferences?: unknown }).notification_preferences
    );
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export async function saveMyNotificationPreferences(
  prefs: NotificationPreferences,
  userIdOverride?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: true };
  }
  const userId = await resolveCurrentAuthenticatedUserId(userIdOverride);
  if (!userId) {
    return { ok: false, error: 'Sign in required to save server alert preferences.' };
  }

  try {
    const normalized = normalizeNotificationPreferences(prefs);
    const { error } = await supabase
      .from('profiles')
      .update({
        notification_preferences: normalized,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not save notification preferences.',
    };
  }
}
