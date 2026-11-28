import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { MediatorWorkspaceRouteClient } from '@/components/workspaces/routes/MediatorWorkspaceRouteClient';

export default async function MediatorWorkspacePage() {
  const ctx = await requireWorkspaceAccess(['mediator'], '/workspace/mediator');

  return (
    <MediatorWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
    />
  );
}
