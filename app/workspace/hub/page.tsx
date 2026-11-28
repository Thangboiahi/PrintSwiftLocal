import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { HubWorkspaceRouteClient } from '@/components/workspaces/routes/HubWorkspaceRouteClient';

export default async function HubWorkspacePage() {
  const ctx = await requireWorkspaceAccess(['hub_manager'], '/workspace/hub');

  return (
    <HubWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
    />
  );
}
