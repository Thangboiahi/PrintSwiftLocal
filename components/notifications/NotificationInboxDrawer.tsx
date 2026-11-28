'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Filter,
  Settings,
  X,
} from 'lucide-react';
import {
  formatRelativeIstTime,
  NOTIFICATION_CATEGORIES_META,
  type LiveNotificationRecord,
  type NotificationCategory,
} from '@/lib/supabase/notifications';
import { useModalBackHandler } from '@/hooks/useModalLock';

export interface NotificationInboxDrawerProps {
  notifications: LiveNotificationRecord[];
  isLoading?: boolean;
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: (category?: NotificationCategory | 'all') => void;
  onViewAllActivity?: () => void;
  onClose?: () => void;
}

const FILTER_CHIPS: ReadonlyArray<{
  id: 'all' | NotificationCategory;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  ...NOTIFICATION_CATEGORIES_META.map((c) => ({
    id: c.id,
    label: c.chipLabel,
  })),
];

const CATEGORY_BADGE_LABELS: Record<NotificationCategory, string> = {
  orders_bookings: 'Orders & Bookings',
  logistics_escrow: 'Logistics & Escrow',
  enquiries_reviews: 'Enquiries & Visits',
  moderation_kyc: 'Moderation & KYC',
  billing_trials: 'Billing & Plans',
  team_staff: 'Team & Staff',
  system: 'System',
};

const ROLE_SCOPE_LABELS: Record<string, string> = {
  visitor: 'Personal',
  owner: 'Owner',
  staff: 'Staff',
  driver: 'Driver',
  mediator: 'Mediator',
  hub_manager: 'Hub Manager',
  advertiser: 'Advertiser',
  super_admin: 'Master',
};

export function NotificationInboxDrawer({
  notifications,
  isLoading = false,
  onMarkRead,
  onMarkAllRead,
  onViewAllActivity,
  onClose,
}: NotificationInboxDrawerProps) {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<
    'all' | NotificationCategory
  >('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Support Android hardware back-button while drawer is open on mobile
  useModalBackHandler(true, onClose);

  const totalUnreadCount = useMemo(
    () => notifications.filter((n) => n.is_read === false).length,
    [notifications]
  );

  const unreadByCategory = useMemo(() => {
    const counts: Record<string, number> = { all: totalUnreadCount };
    for (const item of notifications) {
      if (!item.is_read) {
        const cat = item.category || 'system';
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, [notifications, totalUnreadCount]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (unreadOnly && item.is_read) {
        return false;
      }
      return true;
    });
  }, [notifications, selectedCategory, unreadOnly]);

  const activeCategoryUnreadCount =
    selectedCategory === 'all'
      ? totalUnreadCount
      : unreadByCategory[selectedCategory] || 0;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Notifications Inbox"
      data-testid="header-notification-dropdown"
      className="fixed inset-x-2 top-[calc(var(--app-header-height,56px)+6px)] bottom-3 sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[410px] sm:max-h-[78vh] origin-top-right bg-[var(--ps-surface)] shadow-2xl border border-[var(--ps-border)] rounded-2xl overflow-hidden z-[75] flex flex-col"
    >
      {/* Top Header Row */}
      <div className="sticky top-0 z-10 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 pt-3 pb-2.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
            <span className="text-sm font-bold text-[var(--ps-text)] truncate">
              Notifications
            </span>
            {totalUnreadCount > 0 && (
              <span
                data-testid="inbox-unread-count-pill"
                className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums"
              >
                {totalUnreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {activeCategoryUnreadCount > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={() => onMarkAllRead(selectedCategory)}
                data-testid="notification-mark-all-read-btn"
                className="min-h-[36px] inline-flex items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Mark all read</span>
              </button>
            )}

            <Link
              href="/settings#notifications"
              onClick={() => onClose?.()}
              title="Notification Preferences"
              aria-label="Notification Preferences"
              data-testid="notification-inbox-settings-link"
              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>

            <button
              type="button"
              onClick={() => onClose?.()}
              aria-label="Close notifications inbox"
              data-testid="notification-inbox-close-btn"
              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Category Filter Chips + Unread-Only Toggle */}
        <div className="flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Filter notifications by category"
            className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 flex-1"
          >
            {FILTER_CHIPS.map((chip) => {
              const isSelected = selectedCategory === chip.id;
              const unreadForChip = unreadByCategory[chip.id] || 0;
              return (
                <button
                  key={chip.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`notification-filter-chip-${chip.id}`}
                  onClick={() => setSelectedCategory(chip.id)}
                  className={`min-h-[34px] shrink-0 inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <span>{chip.label}</span>
                  {unreadForChip > 0 && (
                    <span
                      className={`min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-extrabold inline-flex items-center justify-center tabular-nums ${
                        isSelected
                          ? 'bg-white/20 text-[var(--ps-accent-fg)]'
                          : 'bg-rose-600 text-white'
                      }`}
                    >
                      {unreadForChip > 99 ? '99+' : unreadForChip}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={unreadOnly}
            data-testid="notification-unread-only-toggle"
            onClick={() => setUnreadOnly((prev) => !prev)}
            className={`min-h-[34px] shrink-0 inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
              unreadOnly
                ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            <Filter className="h-3 w-3" />
            <span>Unread</span>
          </button>
        </div>
      </div>

      {/* Body List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--ps-border)]/70">
        {isLoading ? (
          <div
            data-testid="notification-inbox-skeleton"
            className="p-3.5 space-y-2.5"
          >
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="dd-shimmer h-3.5 w-40 rounded-md" />
                  <div className="dd-shimmer h-3 w-14 rounded-md" />
                </div>
                <div className="dd-shimmer h-3 w-full rounded-md" />
                <div className="dd-shimmer h-3 w-2/3 rounded-md" />
              </div>
            ))}
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div
            data-testid="notification-inbox-empty"
            className="px-4 py-8 text-center space-y-2"
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]">
              <Bell className="h-4 w-4" />
            </div>
            <p className="text-xs font-bold text-[var(--ps-text)]">
              {unreadOnly
                ? 'No unread notifications in this category'
                : 'You’re all caught up'}
            </p>
            <p className="text-[11px] text-[var(--ps-text-muted)] max-w-xs mx-auto">
              {selectedCategory === 'all'
                ? 'Live updates for orders, bookings, Pick N Drop escrow, enquiries, and moderation appear here.'
                : `No ${
                    CATEGORY_BADGE_LABELS[selectedCategory] || 'category'
                  } alerts right now.`}
            </p>
          </div>
        ) : (
          filteredNotifications.slice(0, 35).map((item) => {
            const isUnread = item.is_read === false;
            const isUrgent = item.priority === 'urgent';
            const isHigh = item.priority === 'high';
            const categoryLabel =
              CATEGORY_BADGE_LABELS[item.category || 'system'] || 'Update';
            const roleLabel =
              item.role_scope && item.role_scope !== 'visitor'
                ? ROLE_SCOPE_LABELS[item.role_scope] || null
                : null;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (isUnread) {
                    onMarkRead?.(item.id);
                  }
                  onClose?.();
                  if (item.action_url && item.action_url.startsWith('/')) {
                    router.push(item.action_url);
                  }
                }}
                data-testid={`notification-item-${item.id}`}
                data-priority={item.priority}
                data-category={item.category}
                className={`w-full text-left px-3.5 py-3 transition-colors hover:bg-[var(--ps-surface-alt)] cursor-pointer ${
                  isUrgent && isUnread
                    ? 'bg-rose-500/8'
                    : isUnread
                      ? 'bg-[var(--ps-accent)]/5'
                      : ''
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {/* Priority / Unread Dot */}
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      isUrgent
                        ? 'bg-rose-600 ring-2 ring-rose-500/30 animate-pulse'
                        : isUnread
                          ? isHigh
                            ? 'bg-amber-500'
                            : 'bg-[var(--ps-accent)]'
                          : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  />

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          {categoryLabel}
                        </span>
                        {roleLabel && (
                          <span className="rounded-md bg-[var(--ps-accent)]/12 px-1.5 py-0.5 text-[9px] font-bold text-[var(--ps-accent)]">
                            {roleLabel}
                          </span>
                        )}
                        {isUrgent && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Urgent
                          </span>
                        )}
                      </div>

                      <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-[var(--ps-text-muted)]">
                        <Clock className="h-2.5 w-2.5" />
                        <span>{formatRelativeIstTime(item.created_at)}</span>
                        {!isUnread ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3 text-[var(--ps-text-muted)]" />
                        )}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-[var(--ps-text)] leading-snug">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2 leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 z-10 w-full border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/90 px-3.5 py-2.5 flex items-center justify-between gap-2">
        <Link
          href="/activity"
          onClick={() => {
            onViewAllActivity?.();
            onClose?.();
          }}
          data-testid="notification-dropdown-view-all-activities"
          className="text-xs font-bold text-[var(--ps-accent)] hover:underline"
        >
          Open My Activity &amp; Ledger →
        </Link>
        <Link
          href="/settings#notifications"
          onClick={() => onClose?.()}
          className="text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
        >
          Mute settings
        </Link>
      </div>
    </div>
  );
}

export default NotificationInboxDrawer;
