'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ActivityPanel } from '@/components/discovery/ActivityPanel';
import { triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';

export default function ActivitiesRoutePage() {
  const router = useRouter();

  const handleBackToExplore = () => {
    triggerUnmountOverlaysToMap();
    router.push('/');
  };

  return (
    <div
      data-testid="activities-route-page"
      className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      <ActivityPanel onBackToExplore={handleBackToExplore} />
    </div>
  );
}
