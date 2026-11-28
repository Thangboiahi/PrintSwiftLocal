import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { DriverWorkspaceRouteClient } from '@/components/workspaces/routes/DriverWorkspaceRouteClient';

export default async function DriverWorkspacePage() {
  const ctx = await requireWorkspaceAccess(['driver'], '/workspace/driver');

  return (
    <DriverWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
    />
  );
}
