import React from 'react';
import type { Metadata } from 'next';
import { UnifiedBookingsHub } from '@/components/bookings/UnifiedBookingsHub';

export const metadata: Metadata = {
  title: 'Vehicles, Commuter Seats & Charter Fleet | DD oodle',
  description:
    'Book verified inter-hub buses, Winger/Bolero/Sumo fixed-route seats, and full-vehicle charters with transparent local fares.',
  openGraph: {
    title: 'Vehicles, Commuter Seats & Charter Fleet | DD oodle',
    description:
      'Book verified inter-hub buses, Winger/Bolero/Sumo fixed-route seats, and full-vehicle charters with transparent local fares.',
    type: 'website',
    url: '/vehicles',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'DD oodle Vehicles & Charter Fleet',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vehicles, Commuter Seats & Charter Fleet | DD oodle',
    description:
      'Book verified inter-hub buses, Winger/Bolero/Sumo fixed-route seats, and full-vehicle charters with transparent local fares.',
    images: ['/icons/icon-512x512.png'],
  },
};

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
