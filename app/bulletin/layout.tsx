import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Town Bulletin — Local Notices, Events, Deals & Jobs | DD oodle',
  description:
    'Read verified community notices, public alerts, local events, deals, and job openings posted across your town.',
  openGraph: {
    title: 'Town Bulletin — Local Notices, Events, Deals & Jobs | DD oodle',
    description:
      'Read verified community notices, public alerts, local events, deals, and job openings posted across your town.',
    type: 'website',
    url: '/bulletin',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'DD oodle Town Bulletin',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Town Bulletin — Local Notices, Events, Deals & Jobs | DD oodle',
    description:
      'Read verified community notices, public alerts, local events, deals, and job openings posted across your town.',
    images: ['/icons/icon-512x512.png'],
  },
};

export default function BulletinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
