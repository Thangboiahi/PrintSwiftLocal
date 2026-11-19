'use client';

export type MapActivityStatus = 'idle' | 'moving' | 'loading';

export interface GlobalStatusPillProps {
  isLoading?: boolean;
  isFetching?: boolean;
  isMoving?: boolean;
  isUpdating?: boolean;
  statusOverride?: MapActivityStatus | 'fetching' | 'updating';
}

export function GlobalStatusPill(_props: GlobalStatusPillProps = {}) {
  return null;
}

export default GlobalStatusPill;

