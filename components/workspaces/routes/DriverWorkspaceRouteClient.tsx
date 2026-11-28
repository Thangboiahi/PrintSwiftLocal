'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { WorkspaceRouteHeaderBar } from '@/components/workspaces/shared/WorkspaceRouteHeaderBar';
import type { CanonicalWorkspaceHat } from '@/lib/auth/workspace-guard';

const DriverWorkspace = dynamic(
  () => import('@/components/workspaces/DriverWorkspace'),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
        <div className="dd-shimmer h-12 w-full rounded-2xl border border-[var(--ps-border)]" />
        <div className="dd-shimmer h-72 w-full rounded-2xl border border-[var(--ps-border)]" />
      </div>
    ),
  }
);

export interface DriverWorkspaceRouteClientProps {
  authorizedHats: CanonicalWorkspaceHat[];
  hatCounts?: Partial<Record<CanonicalWorkspaceHat, number>>;
}

export function DriverWorkspaceRouteClient({
  authorizedHats,
  hatCounts,
}: DriverWorkspaceRouteClientProps) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip bg-[var(--ps-bg)] text-[var(--ps-text)] min-h-[calc(100dvh-var(--app-header-height,56px))]">
      <WorkspaceRouteHeaderBar
        activeHat="driver"
        authorizedHats={authorizedHats}
        hatCounts={hatCounts}
      />
      <div className="w-full min-w-0 max-w-full overflow-x-clip">
        <DriverWorkspace />
      </div>
    </div>
  );
}

export default DriverWorkspaceRouteClient;
