import React from 'react';
import AppShell from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_PLATFORM_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  return (
    <div
      data-testid="explore-page-wrapper"
      className="w-full h-dvh p-4 flex flex-col gap-4 overflow-hidden"
    >
      <AppShell apiKey={apiKey} />
    </div>
  );
}

