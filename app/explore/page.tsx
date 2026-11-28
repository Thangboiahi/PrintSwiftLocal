import React, { Suspense } from 'react';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Explore Local Map & Directory | DD oodle',
  description:
    'Discover verified local shops, restaurants, print hubs, stays, emergency services, and transport stands on the interactive DD oodle map.',
  openGraph: {
    title: 'Explore Local Map & Directory | DD oodle',
    description:
      'Discover verified local shops, restaurants, print hubs, stays, emergency services, and transport stands on the interactive DD oodle map.',
    type: 'website',
    url: '/explore',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'Explore DD oodle Map & Directory',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Explore Local Map & Directory | DD oodle',
    description:
      'Discover verified local shops, restaurants, print hubs, stays, emergency services, and transport stands on the interactive DD oodle map.',
    images: ['/icons/icon-512x512.png'],
  },
};

/**
 * /explore route entry point.
 * Note: Root layout (/app/layout.tsx) wraps all routes in <AppShell>, which renders
 * the active <DiscoveryWorkspace> session container when pathname === '/explore'.
 * We intentionally do not nest a second <AppShell> here to prevent duplicate mounting.
 */
export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <div data-testid="explore-page-active" className="sr-only" aria-hidden="true" />
    </Suspense>
  );
}
