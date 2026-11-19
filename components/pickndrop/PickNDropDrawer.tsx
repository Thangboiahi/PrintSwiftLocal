'use client';

import React from 'react';
import {
  PickNDropPanel,
  type PickNDropPanelProps,
} from '@/components/pickndrop/PickNDropPanel';
import type {
  DeliveryTripType,
  PickNDropPoint,
} from '@/lib/pick-n-drop/types';

export interface PickNDropDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  pickup: PickNDropPoint | null;
  dropoff: PickNDropPoint | null;
  onChangePickup: (point: PickNDropPoint | null) => void;
  onChangeDropoff: (point: PickNDropPoint | null) => void;
  activePinTarget: 'pickup' | 'dropoff' | null;
  onSelectPinTarget: (target: 'pickup' | 'dropoff' | null) => void;
  onTripTypeChange?: (tripType: DeliveryTripType) => void;
}

/**
 * Backward-compatible inline wrapper around PickNDropPanel.
 * Phase 60-C removed floating absolute/fixed map-overlay positioning so
 * Pick N Drop docks natively inside the Listings side panel / bottom sheet.
 */
export function PickNDropDrawer({
  isOpen,
  onClose,
  ...rest
}: PickNDropDrawerProps) {
  if (!isOpen) return null;
  return (
    <PickNDropPanel
      isActive={isOpen}
      onBackToListings={onClose}
      showPanelHeader
      {...rest}
    />
  );
}

export { PickNDropPanel };
export type { PickNDropPanelProps };
export default PickNDropDrawer;
