import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import AppShell from '@/components/AppShell';
import { ThemeScaleProvider } from '@/components/providers/ThemeScaleProvider';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { AssistantWidget } from '@/components/shared/AssistantWidget';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { getServerSessionContext } from '@/lib/auth-server';
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_PLATFORM_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  const serverContext = await getServerSessionContext();

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${jakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeScaleProvider>
          <SplashScreen />
          <OfflineBanner />
          <AppShell
            apiKey={apiKey}
            serverViewAsRole={serverContext.viewAsRole}
            serverProfile={serverContext.profile}
            serverMapSettings={serverContext.mapSettings}
          >
            {children}
          </AppShell>
          <AssistantWidget />
        </ThemeScaleProvider>
      </body>
    </html>
  );
}



