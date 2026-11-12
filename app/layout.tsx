import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'PrintSwift Local',
  description:
    'A map-first local discovery and multi-category listing prototype for Churachandpur, Manipur, featuring interactive Google Maps, compulsory 360° real-estate panoramas, business product catalogues, and multi-role governance workspaces.',
  openGraph: {
    title: 'PrintSwift Local',
    description:
      'A map-first local discovery and multi-category listing prototype for Churachandpur, Manipur, featuring interactive Google Maps, compulsory 360° real-estate panoramas, business product catalogues, and multi-role governance workspaces.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PrintSwift Local',
    description:
      'A map-first local discovery and multi-category listing prototype for Churachandpur, Manipur, featuring interactive Google Maps, compulsory 360° real-estate panoramas, business product catalogues, and multi-role governance workspaces.',
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
        {children}
      </body>
    </html>
  );
}
