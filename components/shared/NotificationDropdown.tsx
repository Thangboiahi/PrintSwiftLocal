'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Bell, CheckCircle2, Clock } from 'lucide-react';
import { LiveNotificationRecord } from '@/lib/supabase/notifications';

export interface NotificationDropdownProps {
  notifications: LiveNotificationRecord[];
  isLoading?: boolean;
  onMarkRead?: (id: string) => void;
  onViewAllActivity?: () => void;
  onClose?: () => void;
}

function formatNotificationTime(iso: string): string {
  if (!iso) return 'Just now';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationDropdown({
  notifications,
  isLoading = false,
  onMarkRead,
  onViewAllActivity,
  onClose,
}: NotificationDropdownProps) {
  const router = useRouter();
  const recentNotifications = notifications.slice(0, 10);
  const unreadCount = notifications.filter((n) => n.is_read === false).length;

  return (
    <div
      role="dialog"
      aria-label="Recent Notifications"
      data-testid="header-notification-dropdown"
      className="fixed left-1/2 -translate-x-1/2 top-[72px] w-[calc(100vw-32px)] max-w-sm sm:absolute sm:left-auto sm:translate-x-0 sm:right-0 sm:top-full sm:mt-2 sm:w-80 max-h-[75vh] overflow-y-auto origin-top-right bg-white dark:bg-slate-900 shadow-2xl border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden z-[70] flex flex-col"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[var(--ps-accent)]" />
          <span className="text-xs font-bold text-[var(--ps-text)]">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
              {unreadCount}
            </span>
          )}
        </div>
        {onViewAllActivity && (
          <Link
            href="/activity"
            onClick={() => {
              onClose?.();
            }}
            className="text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
          >
            View all
          </Link>
        )}
      </div>

      <div className="flex-1 divide-y divide-gray-200/70 dark:divide-gray-800/70">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--ps-text-muted)]">
            Loading notifications…
          </div>
        ) : recentNotifications.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--ps-text-muted)]">
            You&apos;re all caught up. No recent notifications.
          </div>
        ) : (
          recentNotifications.map((item) => {
            const isUnread = item.is_read === false;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onMarkRead?.(item.id);
                  onClose?.();
                  if (item.action_url && item.action_url.startsWith('/')) {
                    router.push(item.action_url);
                  }
                }}
                data-testid={`notification-item-${item.id}`}
                className={`w-full text-left px-4 py-3 transition-colors hover:bg-[var(--ps-surface-alt)] cursor-pointer ${
                  isUnread ? 'bg-blue-500/5' : ''
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      isUnread
                        ? 'bg-rose-600'
                        : 'bg-gray-300 dark:bg-gray-700'
                    }`}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                        {item.title}
                      </span>
                      <span className="inline-flex items-center gap-1 shrink-0">
                        {!isUnread && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <ArrowUpRight className="h-3 w-3 text-[var(--ps-text-muted)]" />
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2 leading-relaxed">
                      {item.message}
                    </p>
                    <div className="flex items-center gap-1 pt-0.5 text-[10px] text-[var(--ps-text-muted)]">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{formatNotificationTime(item.created_at)}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="sticky bottom-0 z-10 w-full">
        <Link
          href="/activities"
          onClick={() => {
            onClose?.();
          }}
          data-testid="notification-dropdown-view-all-activities"
          className="block w-full text-center py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 text-sm font-medium text-blue-600 hover:underline"
        >
          View All Activities
        </Link>
      </div>
    </div>
  );
}

export default NotificationDropdown;
