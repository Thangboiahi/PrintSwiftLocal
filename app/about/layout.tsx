import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'About DD oodle — Local Discovery, Print, Delivery & Fleet Hub',
  description:
    'Learn how DD oodle connects local businesses, print shops, commuter vehicles, delivery drivers, and community services in one platform.',
  openGraph: {
    title: 'About DD oodle — Local Discovery, Print, Delivery & Fleet Hub',
    description:
      'Learn how DD oodle connects local businesses, print shops, commuter vehicles, delivery drivers, and community services in one platform.',
    type: 'website',
    url: '/about',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'About DD oodle',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About DD oodle — Local Discovery, Print, Delivery & Fleet Hub',
    description:
      'Learn how DD oodle connects local businesses, print shops, commuter vehicles, delivery drivers, and community services in one platform.',
    images: ['/icons/icon-512x512.png'],
  },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
