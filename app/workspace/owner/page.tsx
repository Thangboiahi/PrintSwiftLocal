import React from 'react';
import { requireWorkspaceAccess } from '@/lib/auth/workspace-guard';
import { OwnerWorkspaceRouteClient } from '@/components/workspaces/routes/OwnerWorkspaceRouteClient';

export default async function OwnerWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawListing = params?.listing;
  const listingId =
    typeof rawListing === 'string' && rawListing.trim()
      ? rawListing.trim()
      : null;

  const ctx = await requireWorkspaceAccess(['owner'], '/workspace/owner');

  return (
    <OwnerWorkspaceRouteClient
      authorizedHats={ctx.authorizedHats}
      hatCounts={ctx.hatCounts}
      initialListingId={listingId}
    />
  );
}
