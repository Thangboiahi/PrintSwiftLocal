'use client';

import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { NotificationDropdown, NotificationDropdownProps } from '@/components/shared/NotificationDropdown';

export { NotificationDropdown };
export type { NotificationDropdownProps };

export interface NotificationBellProps extends Partial<NotificationDropdownProps> {
  unreadCount?: number;
}

export function NotificationBell({
  notifications = [],
  unreadCount = 0,
  isLoading = false,
  onMarkRead,
  onViewAllActivity,
  onClose,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="sm:relative flex items-center">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Open notifications"
        aria-expanded={isOpen}
        className="relative inline-flex items-center justify-center min-h-[40px] min-w-[40px] p-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed left-1/2 -translate-x-1/2 top-[72px] w-[calc(100vw-32px)] max-w-sm sm:absolute sm:left-auto sm:translate-x-0 sm:right-0 sm:top-full sm:mt-2 sm:w-80 bg-white dark:bg-slate-900 shadow-2xl border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden z-[70]">
          <NotificationDropdown
            notifications={notifications}
            isLoading={isLoading}
            onMarkRead={onMarkRead}
            onViewAllActivity={onViewAllActivity}
            onClose={() => {
              setIsOpen(false);
              onClose?.();
            }}
          />
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
