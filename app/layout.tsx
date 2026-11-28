import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import AppShell from '@/components/AppShell';
import { ThemeScaleProvider } from '@/components/providers/ThemeScaleProvider';
import { AppConfigProvider } from '@/components/providers/AppConfigProvider';
import { AssistantWidget } from '@/components/shared/AssistantWidget';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { getServerSessionContext } from '@/lib/auth-server';
import { getPublicSupabaseConfig } from '@/lib/env';
import './globals.css';

export const dynamic = 'force-dynamic';

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

const siteBaseUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.APP_URL ||
  'https://ddoodle.in'
).replace(/\/+$/, '');

export const metadata: Metadata = {
  metadataBase: new URL(siteBaseUrl),
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
    images: [
      {
        url: '/icons/icon-512x512.png',
        width: 512,
        height: 512,
        alt: 'DD oodle — Your Daily Discovery',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DD oodle — Your Daily Discovery',
    description: 'Your Daily Discovery',
    images: ['/icons/icon-512x512.png'],
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

  const publicSupabaseConfig = getPublicSupabaseConfig();
  const serializedSupabaseConfig = JSON.stringify(publicSupabaseConfig).replace(
    /</g,
    '\\u003c'
  );
  const serverContext = await getServerSessionContext();

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${jakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          id="dd-supabase-runtime-config"
          dangerouslySetInnerHTML={{
            __html: `window.__DD_SUPABASE_CONFIG__ = ${serializedSupabaseConfig};`,
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeScaleProvider>
          <AppConfigProvider>
            <SplashScreen />
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



