import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Contact & Help Desk | DD oodle',
  description:
    'Reach the DD oodle local operations team for business onboarding, order assistance, fleet registration, or partner enquiries.',
  openGraph: {
    title: 'Contact & Help Desk | DD oodle',
    description:
      'Reach the DD oodle local operations team for business onboarding, order assistance, fleet registration, or partner enquiries.',
    type: 'website',
    url: '/contact',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'Contact DD oodle',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact & Help Desk | DD oodle',
    description:
      'Reach the DD oodle local operations team for business onboarding, order assistance, fleet registration, or partner enquiries.',
    images: ['/icons/icon-512x512.png'],
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
