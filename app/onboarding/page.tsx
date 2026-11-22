'use client';

import React, { Suspense } from 'react';
import { PartnerOnboardingClient } from '@/components/onboarding/PartnerOnboardingClient';
import { ProfileSkeleton } from '@/components/shared/Skeletons';

/**
 * DD oodle — Pass V9-A: Unified Partner, Driver & Advertiser Application Center
 * Eliminates the duplicate profile-setup form (profile editing lives cleanly at
 * /profile/edit and hub switching in UnifiedHubModal / /settings).
 */
export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10">
          <div className="w-full max-w-lg mx-auto p-6">
            <ProfileSkeleton />
          </div>
        </main>
      }
    >
      <PartnerOnboardingClient />
    </Suspense>
  );
}
