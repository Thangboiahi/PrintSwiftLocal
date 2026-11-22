import React from 'react';
import type { Metadata } from 'next';
import {
  UnifiedBookingsHub,
  type BookingsHubTab,
} from '@/components/bookings/UnifiedBookingsHub';

export const metadata: Metadata = {
  title: 'Scheduled Bookings Hub — DD oodle',
  description:
    'Book inter-hub buses, Bolero/Sumo seats, turfs, stays, upcoming events, and tables in one place.',
};

interface BookingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readSingleParam(
  raw: string | string[] | undefined
): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

export default async function BookingsPage({ searchParams }: BookingsPageProps) {
  const params = await searchParams;
  const rawTab = readSingleParam(params?.tab)?.trim().toLowerCase();
  const initialTab: BookingsHubTab =
    rawTab === 'vehicles' ||
    rawTab === 'venues' ||
    rawTab === 'stays' ||
    rawTab === 'events' ||
    rawTab === 'tables'
      ? rawTab
      : 'all';
  const initialQuery = readSingleParam(params?.q)?.trim() || '';
  const initialType = readSingleParam(params?.type)?.trim().toLowerCase() || 'all';

  return (
    <UnifiedBookingsHub
      initialTab={initialTab}
      initialQuery={initialQuery}
      initialType={initialType}
    />
  );
}
