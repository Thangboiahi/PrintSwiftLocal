import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { AdminWorkspaceRouteClient } from '@/components/workspaces/routes/AdminWorkspaceRouteClient';

export default async function AdminPage() {
  const ctx = await requireWorkspaceAccess(['admin', 'super_admin'], '/admin');

  return (
    <AdminWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
    />
  );
}
