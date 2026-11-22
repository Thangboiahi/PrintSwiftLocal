import React from 'react';
import { UnifiedBookingsHub } from '@/components/bookings/UnifiedBookingsHub';

interface VehiclesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readSingleParam(
  raw: string | string[] | undefined
): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

export default async function VehiclesIndexPage({
  searchParams,
}: VehiclesPageProps) {
  const params = await searchParams;
  const initialQuery = readSingleParam(params?.q)?.trim() || '';
  const initialType =
    readSingleParam(params?.type)?.trim().toLowerCase() || 'all';

  return (
    <UnifiedBookingsHub
      initialTab="vehicles"
      initialQuery={initialQuery}
      initialType={initialType}
    />
  );
}
