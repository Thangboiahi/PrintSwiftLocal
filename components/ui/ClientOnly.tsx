'use client';

import React from 'react';
import { useIsMounted } from '@/lib/hooks/useIsMounted';

export function ClientOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const isMounted = useIsMounted();
  if (!isMounted) return <>{fallback}</>;
  return <>{children}</>;
}
