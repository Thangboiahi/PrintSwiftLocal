import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Interactive Role Guides & Workflows (All 8 Roles) | DD oodle',
  description:
    'Step-by-step interactive checklists, escrow & OTP safety rules, and operational workflows for Visitors, Business Owners, Staff, Drivers, Mediators, Hub Managers, Advertisers, and Superadmins.',
  openGraph: {
    title: 'Interactive Role Guides & Workflows (All 8 Roles) | DD oodle',
    description:
      'Step-by-step interactive checklists, escrow & OTP safety rules, and operational workflows for all 8 DD oodle roles.',
    type: 'website',
    url: '/guides',
    siteName: 'DD oodle',
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'DD oodle Interactive Role Guides',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Interactive Role Guides & Workflows (All 8 Roles) | DD oodle',
    description:
      'Step-by-step interactive checklists, escrow & OTP safety rules, and operational workflows for all 8 DD oodle roles.',
    images: ['/icons/icon-512x512.png'],
  },
};

export default function GuidesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
