'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Clock, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchUserActivityLogs,
  type LiveActivityLogRecord,
} from '@/lib/supabase/notifications';

export interface ActivityFeedFallbackItem {
  id: string;
  label: string;
  timestamp: string;
}

export interface ActivityFeedProps {
  userId?: string;
  title?: string;
  limit?: number;
  fallbackItems?: ActivityFeedFallbackItem[];
  className?: string;
}

function formatActionLabel(log: LiveActivityLogRecord): string {
  const raw = (log.action_type || '').trim();
  const normalized = raw.toLowerCase();

  if (normalized === 'listing_approved') {
    return log.entity_id
      ? `Listing "${log.entity_id}" was approved`
      : 'Listing was approved';
  }
  if (normalized === 'listing_rejected') {
    return log.entity_id
      ? `Listing "${log.entity_id}" was rejected`
      : 'Listing was rejected';
  }
  if (normalized === 'enquiry_received') {
    return log.entity_id
      ? `New enquiry received for ${log.entity_id}`
      : 'New enquiry received';
  }

  const humanized = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return log.entity_id ? `${humanized} (${log.entity_id})` : humanized;
}

function formatTimestamp(iso: string): string {
  if (!iso) return 'Recent';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function ActivityFeed({
  userId,
  title = 'Recent Activity Feed',
  limit = 10,
  fallbackItems = [],
  className = '',
}: ActivityFeedProps) {
  const { user: authUser } = useAuth();
  const [logs, setLogs] = useState<LiveActivityLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadLogs() {
      let targetUserId = (userId || authUser?.id || '').trim();

      if (!targetUserId && isSupabaseConfigured()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          targetUserId = session?.user?.id || '';
        } catch {
          targetUserId = '';
        }
      }

      if (!targetUserId) {
        if (active) setIsLoading(false);
        return;
      }

      const rows = await fetchUserActivityLogs(targetUserId);
      if (!active) return;
      setLogs(rows.slice(0, limit));
      setIsLoading(false);
    }

    void loadLogs();

    return () => {
      active = false;
    };
  }, [userId, authUser?.id, limit]);

  const timelineItems =
    logs.length > 0
      ? logs.map((log) => ({
          id: log.id,
          label: formatActionLabel(log),
          timestamp: formatTimestamp(log.created_at),
        }))
      : fallbackItems.slice(0, limit).map((item) => ({
          id: item.id,
          label: item.label,
          timestamp: formatTimestamp(item.timestamp),
        }));

  return (
    <section
      data-testid="workspace-activity-feed"
      className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-5 shadow-sm space-y-4 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--ps-accent)]" />
          <h2 className="text-sm font-bold text-[var(--ps-text)]">{title}</h2>
        </div>
        <span className="text-[11px] font-mono text-[var(--ps-text-muted)]">
          {timelineItems.length} events
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-xs text-[var(--ps-text-muted)] gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
          <span>Loading activity timeline…</span>
        </div>
      ) : timelineItems.length === 0 ? (
        <p className="text-xs text-[var(--ps-text-muted)] py-2">
          No recent activity recorded yet.
        </p>
      ) : (
        <ul className="relative ml-2 border-l border-gray-200 dark:border-gray-800 pl-4 space-y-3.5">
          {timelineItems.map((entry) => (
            <li key={entry.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--ps-surface)] bg-[var(--ps-accent)]"
              />
              <div className="text-xs font-medium text-[var(--ps-text)] leading-snug">
                {entry.label}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                <Clock className="h-3 w-3 shrink-0" />
                <span>{entry.timestamp}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ActivityFeed;
