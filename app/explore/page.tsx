import React, { Suspense } from 'react';

export const dynamic = 'force-dynamic';

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
