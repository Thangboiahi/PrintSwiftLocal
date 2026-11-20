import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { resolveServiceHubByIdOrDefault } from '@/lib/config/server';
import {
  createServerSupabaseReadClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

export const dynamic = 'force-dynamic';

export interface LocalitySuggestionItem {
  id: string | null;
  hub_id: string;
  slug: string | null;
  display_name: string;
  secondary_text?: string | null;
  aliases: string[];
  lat: number | null;
  lng: number | null;
  source: string;
  status: 'verified' | 'pending' | 'external';
  usage_count: number;
  origin: 'local_verified' | 'local_pending' | 'google_reference';
  place_id?: string | null;
}

interface GooglePlacePrediction {
  place_id?: string;
  description?: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

interface GoogleAutocompleteResponse {
  status?: string;
  predictions?: GooglePlacePrediction[];
}

function createOptionalUserClient(req: NextRequest): SupabaseClient | null {
  const token = extractSupabaseAccessToken(req);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return null;

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getUsableGoogleMapsKey(): string | null {
  const raw = (
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();

  if (
    !raw ||
    raw.length < 12 ||
    raw.toUpperCase().startsWith('YOUR_') ||
    raw.toLowerCase().includes('placeholder')
  ) {
    return null;
  }
  return raw;
}

function normalizeLookupName(val: string): string {
  return val
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hubParam = (
      searchParams.get('hubId') ||
      searchParams.get('hub') ||
      ''
    ).trim();
    const q = (searchParams.get('q') || '').trim().slice(0, 80);
    const sessionToken = (searchParams.get('sessionToken') || '')
      .trim()
      .slice(0, 128);

    const readClient = createServerSupabaseReadClient();
    const userClient = createOptionalUserClient(req);
    const queryClient = userClient || readClient;

    const activeHub = await resolveServiceHubByIdOrDefault(
      readClient,
      hubParam || null
    );

    const localSuggestions: LocalitySuggestionItem[] = [];

    // Step 1 (Free & Instant): Local hub_localities fuzzy/alias search via RPC
    if (queryClient) {
      let rpcWorked = false;
      try {
        const { data, error } = await queryClient.rpc('search_hub_localities', {
          p_hub_id: activeHub.id,
          p_query: q,
          p_limit: 8,
        });

        if (!error && Array.isArray(data)) {
          rpcWorked = true;
          for (const rawRow of data) {
            const row = rawRow as Record<string, unknown>;
            const rawStatus = String(row.status || 'verified').toLowerCase();
            const isVerified = rawStatus === 'verified';
            localSuggestions.push({
              id: row.id ? String(row.id) : null,
              hub_id: String(row.hub_id || activeHub.id),
              slug: row.slug ? String(row.slug) : null,
              display_name: String(row.display_name || ''),
              secondary_text: activeHub.name,
              aliases: Array.isArray(row.aliases)
                ? row.aliases.map((a) => String(a)).filter(Boolean)
                : [],
              lat:
                row.lat !== null &&
                row.lat !== undefined &&
                Number.isFinite(Number(row.lat))
                  ? Number(row.lat)
                  : null,
              lng:
                row.lng !== null &&
                row.lng !== undefined &&
                Number.isFinite(Number(row.lng))
                  ? Number(row.lng)
                  : null,
              source: String(row.source || 'admin_seed'),
              status: isVerified ? 'verified' : 'pending',
              usage_count: Number(row.usage_count ?? 0),
              origin: isVerified ? 'local_verified' : 'local_pending',
              place_id: null,
            });
          }
        }
      } catch {
        // Fallback below if RPC isn't available yet
      }

      // Direct table fallback if RPC wasn't migrated yet
      if (!rpcWorked) {
        try {
          let builder = queryClient
            .from('hub_localities')
            .select(
              'id, hub_id, slug, display_name, aliases, lat, lng, source, status, usage_count'
            )
            .eq('hub_id', activeHub.id)
            .in('status', ['verified', 'pending'])
            .order('usage_count', { ascending: false })
            .order('display_name', { ascending: true })
            .limit(8);

          if (q.length > 0) {
            builder = builder.ilike('display_name', `%${q}%`);
          }

          const { data, error } = await builder;
          if (!error && Array.isArray(data)) {
            for (const rawRow of data) {
              const row = rawRow as Record<string, unknown>;
              const isVerified =
                String(row.status || 'verified').toLowerCase() === 'verified';
              localSuggestions.push({
                id: row.id ? String(row.id) : null,
                hub_id: String(row.hub_id || activeHub.id),
                slug: row.slug ? String(row.slug) : null,
                display_name: String(row.display_name || ''),
                secondary_text: activeHub.name,
                aliases: Array.isArray(row.aliases)
                  ? row.aliases.map((a) => String(a)).filter(Boolean)
                  : [],
                lat:
                  row.lat !== null &&
                  row.lat !== undefined &&
                  Number.isFinite(Number(row.lat))
                    ? Number(row.lat)
                    : null,
                lng:
                  row.lng !== null &&
                  row.lng !== undefined &&
                  Number.isFinite(Number(row.lng))
                    ? Number(row.lng)
                    : null,
                source: String(row.source || 'admin_seed'),
                status: isVerified ? 'verified' : 'pending',
                usage_count: Number(row.usage_count ?? 0),
                origin: isVerified ? 'local_verified' : 'local_pending',
                place_id: null,
              });
            }
          }
        } catch {
          // Graceful empty local list
        }
      }
    }

    const verifiedLocalCount = localSuggestions.filter(
      (item) => item.origin === 'local_verified'
    ).length;

    // Step 2 (Cost-Guarded Google Places Fallback):
    // Trigger ONLY if query >= 3 chars, < 3 verified local matches, and server key exists.
    let usedGoogleFallback = false;
    const googleSuggestions: LocalitySuggestionItem[] = [];
    const googleKey = getUsableGoogleMapsKey();

    if (q.length >= 3 && verifiedLocalCount < 3 && googleKey) {
      const seenNormalized = new Set<string>();
      for (const item of localSuggestions) {
        const normName = normalizeLookupName(item.display_name);
        if (normName) seenNormalized.add(normName);
        for (const alias of item.aliases) {
          const normAlias = normalizeLookupName(alias);
          if (normAlias) seenNormalized.add(normAlias);
        }
      }

      try {
        const radiusMeters = Math.max(
          5000,
          Math.min(50000, Math.round((activeHub.service_radius_km || 25) * 1000))
        );
        const params = new URLSearchParams({
          input: q,
          components: 'country:in',
          locationbias: `circle:${radiusMeters}@${activeHub.center_lat},${activeHub.center_lng}`,
          key: googleKey,
        });
        if (sessionToken) {
          params.set('sessiontoken', sessionToken);
        }

        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
          {
            method: 'GET',
            cache: 'no-store',
            signal: AbortSignal.timeout(3500),
          }
        );

        if (response.ok) {
          const payload = (await response.json()) as GoogleAutocompleteResponse;
          if (
            payload &&
            Array.isArray(payload.predictions) &&
            (payload.status === 'OK' || payload.status === 'ZERO_RESULTS')
          ) {
            usedGoogleFallback = true;
            for (const pred of payload.predictions) {
              if (googleSuggestions.length >= 4) break;

              const rawMain = (
                pred.structured_formatting?.main_text ||
                (pred.description || '').split(',')[0] ||
                ''
              ).trim();
              if (!rawMain || rawMain.length < 2) continue;

              const norm = normalizeLookupName(rawMain);
              if (!norm || seenNormalized.has(norm)) continue;
              seenNormalized.add(norm);

              googleSuggestions.push({
                id: null,
                hub_id: activeHub.id,
                slug: null,
                display_name: rawMain,
                secondary_text:
                  pred.structured_formatting?.secondary_text ||
                  pred.description ||
                  activeHub.name,
                aliases: [],
                lat: null,
                lng: null,
                source: 'google_places',
                status: 'external',
                usage_count: 0,
                origin: 'google_reference',
                place_id: pred.place_id || null,
              });
            }
          }
        }
      } catch {
        // Non-blocking fallback on slow/offline networks
      }
    }

    return NextResponse.json(
      {
        suggestions: [...localSuggestions, ...googleSuggestions],
        usedGoogleFallback,
        hubId: activeHub.id,
        hubSlug: activeHub.slug,
        hubName: activeHub.name,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[GET /api/localities/suggest] Unexpected error:', err);
    return NextResponse.json(
      {
        suggestions: [],
        usedGoogleFallback: false,
        error: 'Failed to load locality suggestions',
      },
      { status: 200 }
    );
  }
}
