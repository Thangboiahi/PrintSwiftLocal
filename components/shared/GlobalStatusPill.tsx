'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, Loader2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export type MapActivityStatus = 'idle' | 'moving' | 'loading';

export interface GlobalStatusPillProps {
  isLoading?: boolean;
  isFetching?: boolean;
  isMoving?: boolean;
  isUpdating?: boolean;
  statusOverride?: MapActivityStatus | 'fetching' | 'updating';
}

export function GlobalStatusPill({
  isLoading: isLoadingOverride,
  isFetching: isFetchingOverride,
  isMoving: isMovingOverride,
  isUpdating = false,
  statusOverride,
}: GlobalStatusPillProps = {}) {
  const store = useAppStore();

  const effectiveLoading = isLoadingOverride ?? store.isLoading;
  const effectiveFetching = isFetchingOverride ?? store.isFetching;
  const effectiveMoving = isMovingOverride ?? store.isMoving;

  let statusKind: 'loading' | 'fetching' | 'updating' | null = null;
  let statusLabel: string | null = null;

  if (statusOverride && statusOverride !== 'idle') {
    if (statusOverride === 'loading') {
      statusKind = 'loading';
      statusLabel = 'Loading...';
    } else if (statusOverride === 'fetching') {
      statusKind = 'fetching';
      statusLabel = 'Fetching...';
    } else {
      statusKind = 'updating';
      statusLabel = 'Updating...';
    }
  } else if (effectiveLoading) {
    statusKind = 'loading';
    statusLabel = 'Loading...';
  } else if (effectiveFetching) {
    statusKind = 'fetching';
    statusLabel = 'Fetching...';
  } else if (effectiveMoving || isUpdating) {
    statusKind = 'updating';
    statusLabel = 'Updating...';
  }

  return (
    <div
      data-testid="global-status-pill-container"
      data-status={statusKind || 'idle'}
      className="absolute top-6 left-1/2 -translate-x-1/2 z-[9000] pointer-events-none"
    >
      <AnimatePresence mode="wait">
        {statusLabel && (
          <motion.div
            key={statusKind}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            role="status"
            aria-live="polite"
            data-testid="global-status-pill"
            className="pointer-events-none inline-flex items-center gap-2 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 px-3.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] shadow-lg backdrop-blur-md"
          >
            {statusKind === 'updating' ? (
              <Compass className="h-3.5 w-3.5 animate-pulse text-[var(--ps-accent)]" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ps-accent)]" />
            )}
            <span>{statusLabel}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default GlobalStatusPill;
