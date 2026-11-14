'use client';

import React, { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { ListingStatus } from '@/lib/types';

export type ModerationActionType = 'Approve' | 'Reject' | 'Request Changes';

export interface ModerationControlsProps {
  listingId: string;
  disabled?: boolean;
  onModerate: (
    listingId: string,
    targetStatus: ListingStatus,
    action: ModerationActionType
  ) => Promise<void> | void;
  className?: string;
}

export function ModerationControls({
  listingId,
  disabled = false,
  onModerate,
  className = '',
}: ModerationControlsProps) {
  const [loadingAction, setLoadingAction] =
    useState<ModerationActionType | null>(null);

  const handleAction = async (
    action: ModerationActionType,
    targetStatus: ListingStatus
  ) => {
    if (disabled || loadingAction !== null) return;
    setLoadingAction(action);
    try {
      await Promise.all([
        Promise.resolve(onModerate(listingId, targetStatus, action)),
        new Promise((resolve) => setTimeout(resolve, 350)),
      ]);
    } finally {
      setLoadingAction(null);
    }
  };

  const isBusy = loadingAction !== null;

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-2 ${className}`}
      role="group"
      aria-label="Moderation Actions"
    >
      <button
        type="button"
        disabled={disabled || isBusy}
        onClick={() => void handleAction('Approve', 'published')}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadingAction === 'Approve' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        <span>Approve</span>
      </button>

      <button
        type="button"
        disabled={disabled || isBusy}
        onClick={() =>
          void handleAction('Request Changes', 'changes_requested')
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadingAction === 'Request Changes' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
        <span>Request Changes</span>
      </button>

      <button
        type="button"
        disabled={disabled || isBusy}
        onClick={() => void handleAction('Reject', 'rejected')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadingAction === 'Reject' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )}
        <span>Reject</span>
      </button>
    </div>
  );
}
