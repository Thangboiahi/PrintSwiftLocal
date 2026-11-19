'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchMyActivityLogs,
  fetchMyNotifications,
  mapNotificationRow,
  markNotificationAsRead,
  type LiveActivityLogRecord,
  type LiveNotificationRecord,
  type SupabaseNotificationRow,
} from '@/lib/supabase/notifications';
import { OrderTrackerModal } from '@/components/pickndrop/OrderTrackerModal';

export interface ActivityPanelProps {
  onBackToExplore?: () => void;
}

export function ActivityPanel({ onBackToExplore }: ActivityPanelProps) {
  const { user: authUser } = useAuth();
  const { markNotificationRead } = useAppStore();

  const [liveNotifications, setLiveNotifications] = useState<
    LiveNotificationRecord[]
  >([]);
  const [liveActivityLogs, setLiveActivityLogs] = useState<
    LiveActivityLogRecord[]
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fetchAndApplyLiveData = useCallback(async () => {
    const [notifs, logs] = await Promise.all([
      fetchMyNotifications(authUser?.id),
      fetchMyActivityLogs(authUser?.id),
    ]);
    setLiveNotifications(notifs);
    setLiveActivityLogs(logs);
    setIsLoading(false);
  }, [authUser?.id]);

  const handleRefreshClick = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchAndApplyLiveData();
    } finally {
      setIsLoading(false);
    }
  }, [fetchAndApplyLiveData]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchMyNotifications(authUser?.id),
      fetchMyActivityLogs(authUser?.id),
    ])
      .then(([notifs, logs]) => {
        if (!active) return;
        setLiveNotifications(notifs);
        setLiveActivityLogs(logs);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUpdated = (ev: Event) => {
      const customEv = ev as CustomEvent<{
        insertedNotification?: LiveNotificationRecord;
        markedReadId?: string;
      }>;
      if (customEv.detail?.insertedNotification) {
        const incoming = customEv.detail.insertedNotification;
        setLiveNotifications((prev) =>
          prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]
        );
        return;
      }
      if (customEv.detail?.markedReadId) {
        const targetId = customEv.detail.markedReadId;
        setLiveNotifications((prev) =>
          prev.map((n) =>
            n.id === targetId ? { ...n, is_read: true, read: true } : n
          )
        );
        return;
      }
      void fetchAndApplyLiveData();
    };
    window.addEventListener('printswift:notifications-updated', handleUpdated);
    return () => {
      window.removeEventListener(
        'printswift:notifications-updated',
        handleUpdated
      );
    };
  }, [fetchAndApplyLiveData]);

  // Phase 35: Real-time Supabase WebSocket subscription listening for INSERT events on notifications
  useEffect(() => {
    if (!isSupabaseConfigured() || !authUser?.id) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      const channelName = `activity-panel-notifications-${authUser.id}-${Date.now()}-${Math.random()
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
            filter: `user_id=eq.${authUser.id}`,
          },
          (payload) => {
            const raw = payload.new as SupabaseNotificationRow | undefined;
            if (raw && raw.id) {
              const incoming = mapNotificationRow(raw);
              setLiveNotifications((prev) =>
                prev.some((item) => item.id === incoming.id)
                  ? prev
                  : [incoming, ...prev]
              );
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('printswift:notifications-updated', {
                    detail: { insertedNotification: incoming },
                  })
                );
              }
            }
            void fetchMyActivityLogs(authUser.id).then((logs) => {
              setLiveActivityLogs(logs);
            });
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
          // Ignore cleanup errors
        }
      }
    };
  }, [authUser?.id]);

  const unreadCount = useMemo(
    () => liveNotifications.filter((n) => !n.is_read).length,
    [liveNotifications]
  );

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      setMarkingId(id);
      setLiveNotifications((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, is_read: true, read: true } : item
        )
      );
      markNotificationRead(id);
      await markNotificationAsRead(id);
      setMarkingId(null);
    },
    [markNotificationRead]
  );

  return (
    <div
      data-testid="activity-destination-view"
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              Live Database Sync
            </span>
            <span
              data-testid="activity-unread-badge"
              className="text-xs font-semibold text-[var(--ps-text-muted)]"
            >
              {unreadCount} unread alert{unreadCount === 1 ? '' : 's'}
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-[var(--ps-text)] sm:text-2xl">
            Live Notifications &amp; Activity Log
          </h1>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Real-time alerts triggered automatically when visitors submit enquiries for your listings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="refresh-notifications-btn"
            onClick={() => {
              void handleRefreshClick();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
          {onBackToExplore && (
            <button
              type="button"
              onClick={onBackToExplore}
              className="rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-accent-fg)]"
            >
              Back to Explore
            </button>
          )}
        </div>
      </div>

      {/* Phase 60-B: Customer Active Pick N Drop Orders & Asymmetric OTP Tracker */}
      <OrderTrackerModal
        mode="embedded"
        onStartNewDelivery={onBackToExplore}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Live Notifications Panel */}
        <section
          data-testid="live-notifications-panel"
          className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
              <Bell className="h-4 w-4 text-[var(--ps-accent)]" />
              <span>Notifications ({liveNotifications.length})</span>
            </h2>
            {unreadCount > 0 && (
              <span
                data-testid="panel-unread-count-pill"
                className="rounded-full bg-[var(--ps-accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent-fg)] tabular-nums"
              >
                {unreadCount} Unread
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Syncing live notifications from Supabase…</span>
            </div>
          ) : liveNotifications.length === 0 ? (
            <div
              data-testid="notifications-empty-state"
              className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center"
            >
              <Bell className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
              <p className="mt-2 text-xs font-semibold text-[var(--ps-text)]">
                No live notifications yet
              </p>
              <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                {authUser
                  ? 'Whenever a visitor submits an enquiry on one of your listings, our PostgreSQL trigger will alert you here in real time.'
                  : 'Sign in to view live enquiry alerts and notifications for your account.'}
              </p>
            </div>
          ) : (
            <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
              {liveNotifications.map((notif) => (
                <div
                  key={notif.id}
                  data-testid={`notification-item-${notif.id}`}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 text-xs transition ${
                    notif.is_read
                      ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                      : 'border-[var(--ps-accent)]/50 bg-[var(--ps-surface-alt)] shadow-2xs'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      {!notif.is_read && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--ps-accent)]" />
                      )}
                      <span className="font-bold text-[var(--ps-text)]">
                        {notif.title}
                      </span>
                    </div>
                    <p className="text-[var(--ps-text-muted)]">
                      {notif.message}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] text-[var(--ps-text-muted)]">
                      <Clock className="h-3 w-3" />
                      <span>
                        {notif.created_at
                          .replace('T', ' ')
                          .slice(0, 19)}
                      </span>
                    </div>
                  </div>

                  {!notif.is_read ? (
                    <button
                      type="button"
                      data-testid={`mark-notification-read-${notif.id}`}
                      disabled={markingId === notif.id}
                      onClick={() => {
                        void handleMarkAsRead(notif.id);
                      }}
                      className="shrink-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-[10px] font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-bg)] disabled:opacity-50"
                    >
                      {markingId === notif.id ? 'Saving…' : 'Mark read'}
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Read
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Live Activity Logs Panel */}
        <section
          data-testid="live-activity-logs-panel"
          className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
              <Activity className="h-4 w-4 text-[var(--ps-accent)]" />
              <span>Activity History ({liveActivityLogs.length})</span>
            </h2>
            <span className="font-mono text-[11px] text-[var(--ps-text-muted)]">
              public.activity_logs
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading activity log…</span>
            </div>
          ) : liveActivityLogs.length === 0 ? (
            <div
              data-testid="activity-logs-empty-state"
              className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center"
            >
              <Activity className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
              <p className="mt-2 text-xs font-semibold text-[var(--ps-text)]">
                No recorded activity events yet
              </p>
              <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                Database events such as incoming enquiries and listing updates are logged here automatically.
              </p>
            </div>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {liveActivityLogs.map((log) => (
                <div
                  key={log.id}
                  data-testid={`activity-log-item-${log.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs"
                >
                  <div>
                    <div className="font-semibold capitalize text-[var(--ps-text)]">
                      {log.action_type.replace(/_/g, ' ')}
                    </div>
                    {log.entity_id && (
                      <div className="font-mono text-[11px] text-[var(--ps-text-muted)]">
                        Entity ID: {log.entity_id}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                    {log.created_at.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default ActivityPanel;
