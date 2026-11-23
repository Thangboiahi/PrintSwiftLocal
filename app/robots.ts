import type { MetadataRoute } from 'next';

function resolveSiteBaseUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://ddoodle.in';
  return configured.replace(/\/+$/, '');
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolveSiteBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
