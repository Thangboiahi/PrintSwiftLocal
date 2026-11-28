'use client';

import React, { useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import { WorkspaceRouteHeaderBar } from '@/components/workspaces/shared/WorkspaceRouteHeaderBar';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import type { CanonicalWorkspaceHat } from '@/lib/auth/workspace-guard';

const StaffWorkspace = dynamic(
  () => import('@/components/workspaces/StaffWorkspace'),
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

export interface StaffWorkspaceRouteClientProps {
  authorizedHats: CanonicalWorkspaceHat[];
  hatCounts?: Partial<Record<CanonicalWorkspaceHat, number>>;
}

export function StaffWorkspaceRouteClient({
  authorizedHats,
  hatCounts,
}: StaffWorkspaceRouteClientProps) {
  const router = useRouter();

  const handleOpenListingOnMap = useCallback(
    (listingId: string) => {
      triggerUnmountOverlaysToMap();
      if (listingId && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('printswift:focus-map-listing', {
            detail: { listingId },
          })
        );
      }
      router.push('/explore');
    },
    [router]
  );

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip bg-[var(--ps-bg)] text-[var(--ps-text)] min-h-[calc(100dvh-var(--app-header-height,56px))]">
      <WorkspaceRouteHeaderBar
        activeHat="staff"
        authorizedHats={authorizedHats}
        hatCounts={hatCounts}
      />
      <div className="w-full min-w-0 max-w-full overflow-x-clip">
        <GlobalErrorBoundary contextLabel="Staff Workspace">
          <StaffWorkspace onOpenListingOnMap={handleOpenListingOnMap} />
        </GlobalErrorBoundary>
      </div>
    </div>
  );
}

export default StaffWorkspaceRouteClient;
