import React from 'react';
import type { Metadata } from 'next';
import { CivicDirectoryPageClient } from '@/components/verticals/civic/CivicDirectoryPageClient';

export const metadata: Metadata = {
  title: 'Civic Directory, Emergency Helplines & Public Utilities | DD oodle',
  description:
    'Access verified emergency numbers, hospitals, ambulances, blood donors, government offices, and essential civic services in your hub.',
  openGraph: {
    title: 'Civic Directory, Emergency Helplines & Public Utilities | DD oodle',
    description:
      'Access verified emergency numbers, hospitals, ambulances, blood donors, government offices, and essential civic services in your hub.',
    type: 'website',
    url: '/civic',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'DD oodle Civic & Emergency Directory',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Civic Directory, Emergency Helplines & Public Utilities | DD oodle',
    description:
      'Access verified emergency numbers, hospitals, ambulances, blood donors, government offices, and essential civic services in your hub.',
    images: ['/icons/icon-512x512.png'],
  },
};

export default function CivicDirectoryPage() {
  return <CivicDirectoryPageClient />;
}
