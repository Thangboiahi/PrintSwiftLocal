import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#0284c7',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'PrintSwift Local - Churachandpur Discovery',
  description:
    'Discover public listings, real estate, and local businesses in Lamka (Churachandpur).',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PrintSwift',
  },
  openGraph: {
    title: 'PrintSwift Local - Churachandpur Discovery',
    description:
      'Discover public listings, real estate, and local businesses in Lamka (Churachandpur).',
    type: 'website',
    locale: 'en_IN',
    siteName: 'PrintSwift Local',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PrintSwift Local - Churachandpur Discovery',
    description:
      'Discover public listings, real estate, and local businesses in Lamka (Churachandpur).',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}

