import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Marketplace — Local Products, Food & Print Shops | DD oodle',
  description:
    'Shop verified local retail products, pure veg & restaurant dishes, and instant print-shop services with fast pick-n-drop delivery.',
  openGraph: {
    title: 'Marketplace — Local Products, Food & Print Shops | DD oodle',
    description:
      'Shop verified local retail products, restaurant dishes, and instant print-shop services with fast local delivery.',
    type: 'website',
    url: '/marketplace',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'DD oodle Local Marketplace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marketplace — Local Products, Food & Print Shops | DD oodle',
    description:
      'Shop verified local retail products, restaurant dishes, and instant print-shop services with fast local delivery.',
    images: ['/icons/icon-512x512.png'],
  },
};

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
