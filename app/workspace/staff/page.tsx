import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { StaffWorkspaceRouteClient } from '@/components/workspaces/routes/StaffWorkspaceRouteClient';

export default async function StaffWorkspacePage() {
  const ctx = await requireWorkspaceAccess(['staff'], '/workspace/staff');

  return (
    <StaffWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
    />
  );
}
