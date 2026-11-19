'use client';

import React from 'react';
import {
  DiscoveryWorkspace,
  type DiscoveryWorkspaceProps,
} from '@/components/discovery/DiscoveryWorkspace';
import { fetchSingleListingFullDetails } from '@/lib/api/listings';
import { PickNDropDrawer } from '@/components/pickndrop/PickNDropDrawer';
import { PickNDropPanel } from '@/components/pickndrop/PickNDropPanel';

export function MapWorkspace(props: DiscoveryWorkspaceProps) {
  return (
    <div className="dense-map-ui w-full h-full">
      <DiscoveryWorkspace {...props} />
    </div>
  );
}

export {
  DiscoveryWorkspace,
  PickNDropDrawer,
  PickNDropPanel,
  fetchSingleListingFullDetails,
};
export type { DiscoveryWorkspaceProps };
export default MapWorkspace;


