'use client';

import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import {
  NotificationInboxDrawer,
  type NotificationInboxDrawerProps,
} from '@/components/notifications/NotificationInboxDrawer';

export { NotificationInboxDrawer };
export {
  NotificationInboxDrawer as NotificationDropdown,
  type NotificationInboxDrawerProps as NotificationDropdownProps,
};

export interface NotificationBellProps
  extends Partial<NotificationInboxDrawerProps> {
  unreadCount?: number;
  isOpen?: boolean;
  onOpenChange?: (nextOpen: boolean) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function NotificationBell({
  notifications = [],
  unreadCount = 0,
  isLoading = false,
  isOpen: controlledIsOpen,
  onOpenChange,
  onMarkRead,
  onMarkAllRead,
  onViewAllActivity,
  onClose,
  containerRef,
}: NotificationBellProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen =
    typeof controlledIsOpen === 'boolean' ? controlledIsOpen : internalIsOpen;

  const setOpen = (next: boolean) => {
    if (typeof controlledIsOpen !== 'boolean') {
      setInternalIsOpen(next);
    }
    onOpenChange?.(next);
  };

  const hasUrgentUnread = notifications.some(
    (n) => !n.is_read && n.priority === 'urgent'
  );

  return (
    <div ref={containerRef} className="sm:relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        title="Notifications"
        aria-label="Open Notifications"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        data-testid="header-activity-btn"
        className={`min-h-[44px] min-w-[44px] h-11 w-11 relative flex items-center justify-center rounded-xl border transition-colors cursor-pointer shrink-0 ${
          isOpen
            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
            : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
        }`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            data-testid="header-unread-badge"
            className={`absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-white text-[9px] font-extrabold flex items-center justify-center tabular-nums ${
              hasUrgentUnread ? 'bg-rose-600 animate-pulse' : 'bg-rose-600'
            }`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationInboxDrawer
          notifications={notifications}
          isLoading={isLoading}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          onViewAllActivity={onViewAllActivity}
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      )}
    </div>
  );
}

export default NotificationBell;
