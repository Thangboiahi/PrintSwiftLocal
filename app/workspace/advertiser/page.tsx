import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { AdvertiserWorkspaceRouteClient } from '@/components/workspaces/routes/AdvertiserWorkspaceRouteClient';

export default async function AdvertiserWorkspacePage() {
  const ctx = await requireWorkspaceAccess(
    ['advertiser'],
    '/workspace/advertiser'
  );

  return (
    <AdvertiserWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
    />
  );
}
