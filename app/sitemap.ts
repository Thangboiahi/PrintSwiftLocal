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
  const nowIso = now.toISOString();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/explore`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/marketplace`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/bookings`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/vehicles`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/bulletin`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/civic`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/guides`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.85,
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
    let vehicleEntries: Array<{ id: string; updatedAt?: string }> = [];

    if (isSupabaseConfigured()) {
      const [listingsRes, vehiclesRes] = await Promise.all([
        supabase
          .from('listings')
          .select('id, updated_at, created_at')
          .eq('status', 'published')
          .eq('lifecycle_status', 'active')
          .or(`paid_until.is.null,paid_until.gt.${nowIso}`)
          .order('updated_at', { ascending: false }),
        supabase
          .from('vehicle_listings')
          .select('id, updated_at, created_at')
          .eq('is_active', true)
          .or(`paid_until.is.null,paid_until.gt.${nowIso}`)
          .order('updated_at', { ascending: false }),
      ]);

      if (!listingsRes.error && Array.isArray(listingsRes.data)) {
        listingEntries = listingsRes.data
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

      if (!vehiclesRes.error && Array.isArray(vehiclesRes.data)) {
        vehicleEntries = vehiclesRes.data
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

    const dynamicVehicleRoutes: MetadataRoute.Sitemap = vehicleEntries.map(
      (item) => {
        const parsedDate = item.updatedAt ? new Date(item.updatedAt) : now;
        const validLastModified = Number.isNaN(parsedDate.getTime())
          ? now
          : parsedDate;
        return {
          url: `${baseUrl}/vehicles/${encodeURIComponent(item.id)}`,
          lastModified: validLastModified,
          changeFrequency: 'weekly',
          priority: 0.8,
        };
      }
    );

    return [...staticRoutes, ...dynamicListingRoutes, ...dynamicVehicleRoutes];
  } catch {
    return staticRoutes;
  }
}

