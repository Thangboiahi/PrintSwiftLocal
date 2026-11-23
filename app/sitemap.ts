import type { MetadataRoute } from 'next';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { fetchPublishedListings } from '@/lib/supabase/listings';

function resolveSiteBaseUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://ddoodle.in';
  return configured.replace(/\/+$/, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = resolveSiteBaseUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ];

  try {
    let listingEntries: Array<{ id: string; updatedAt?: string }> = [];

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('listings')
        .select('id, updated_at, created_at')
        .eq('status', 'published')
        .order('updated_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        listingEntries = data
          .filter((row) => Boolean(row?.id))
          .map((row) => ({
            id: String(row.id),
            updatedAt:
              typeof row.updated_at === 'string'
                ? row.updated_at
                : typeof row.created_at === 'string'
                  ? row.created_at
                  : undefined,
          }));
      }
    }

    if (listingEntries.length === 0) {
      const published = await fetchPublishedListings();
      listingEntries = published.map((item) => ({
        id: item.id,
        updatedAt: item.updatedAt || item.createdAt,
      }));
    }

    const dynamicListingRoutes: MetadataRoute.Sitemap = listingEntries.map(
      (item) => {
        const parsedDate = item.updatedAt ? new Date(item.updatedAt) : now;
        const validLastModified = Number.isNaN(parsedDate.getTime())
          ? now
          : parsedDate;
        return {
          url: `${baseUrl}/listing/${encodeURIComponent(item.id)}`,
          lastModified: validLastModified,
          changeFrequency: 'weekly',
          priority: 0.8,
        };
      }
    );

    return [...staticRoutes, ...dynamicListingRoutes];
  } catch {
    return staticRoutes;
  }
}
