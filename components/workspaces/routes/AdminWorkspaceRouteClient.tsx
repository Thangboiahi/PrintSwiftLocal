'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import { WorkspaceRouteHeaderBar } from '@/components/workspaces/shared/WorkspaceRouteHeaderBar';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import type { CanonicalWorkspaceHat } from '@/lib/auth/workspace-guard';

export interface AdminWorkspaceRouteClientProps {
  authorizedHats: CanonicalWorkspaceHat[];
  hatCounts?: Partial<Record<CanonicalWorkspaceHat, number>>;
  serverRole?: string;
  isVerifiedSuperAdmin?: boolean;
}

export function AdminWorkspaceRouteClient({
  authorizedHats,
  hatCounts,
  serverRole,
  isVerifiedSuperAdmin,
}: AdminWorkspaceRouteClientProps) {
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
    <div
      data-testid="admin-workspace-route-root"
      className="w-full min-w-0 max-w-full overflow-x-clip bg-[var(--ps-bg)] text-[var(--ps-text)] min-h-[calc(100dvh-var(--app-header-height,56px))]"
    >
      <WorkspaceRouteHeaderBar
        activeHat="master_control"
        authorizedHats={authorizedHats}
        hatCounts={hatCounts}
      />
      <div className="w-full min-w-0 max-w-full overflow-x-clip px-3 sm:px-5 pb-8">
        <GlobalErrorBoundary contextLabel="Admin Console">
          <AdminWorkspace
            onOpenListingOnMap={handleOpenListingOnMap}
            serverRole={serverRole}
            isVerifiedSuperAdmin={isVerifiedSuperAdmin}
          />
        </GlobalErrorBoundary>
      </div>
    </div>
  );
}

export default AdminWorkspaceRouteClient;

