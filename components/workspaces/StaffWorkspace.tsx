'use client';

import React from 'react';
import OwnerStaffWorkspace from '@/components/workspaces/OwnerStaffWorkspace';
import type { Listing } from '@/lib/types';

export interface StaffWorkspaceProps {
  onOpenListingOnMap: (listingId: string) => void;
  initialDraftListing?: Listing | null;
  onClearInitialDraftListing?: () => void;
}

export function StaffWorkspace({
  onOpenListingOnMap,
  initialDraftListing,
  onClearInitialDraftListing,
}: StaffWorkspaceProps) {
  return (
    <OwnerStaffWorkspace
      forcedRole="staff"
      onOpenListingOnMap={onOpenListingOnMap}
      initialDraftListing={initialDraftListing}
      onClearInitialDraftListing={onClearInitialDraftListing}
    />
  );
}

export default StaffWorkspace;
