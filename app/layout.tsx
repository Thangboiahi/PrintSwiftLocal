import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import AppShell from '@/components/AppShell';
import { ThemeScaleProvider } from '@/components/providers/ThemeScaleProvider';
import { AppConfigProvider } from '@/components/providers/AppConfigProvider';
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
  themeColor: '#1D7578',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'DD oodle — Your Daily Discovery',
  description: 'Your Daily Discovery',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'DD oodle',
  },
  openGraph: {
    title: 'DD oodle — Your Daily Discovery',
    description: 'Your Daily Discovery',
    type: 'website',
    locale: 'en_IN',
    siteName: 'DD oodle',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DD oodle — Your Daily Discovery',
    description: 'Your Daily Discovery',
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
          <AppConfigProvider>
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
          </AppConfigProvider>
        </ThemeScaleProvider>
      </body>
    </html>
  );
}



