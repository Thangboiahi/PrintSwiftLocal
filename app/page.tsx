import React from 'react';
import AppShell from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_PLATFORM_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  return <AppShell apiKey={apiKey} />;
}
