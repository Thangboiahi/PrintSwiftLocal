import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { resolveServiceHubByIdOrDefault } from '@/lib/config/server';
import {
  createServerSupabaseReadClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

export const dynamic = 'force-dynamic';

const ALLOWED_SOURCES = new Set(['user_submitted', 'google_places']);

export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase is not configured on the server.' },
        { status: 503 }
      );
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required to add or resolve a locality.' },
        { status: 401 }
      );
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
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

    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired session. Please sign in again.' },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      hubId?: string | null;
      name?: string;
      lat?: number | null;
      lng?: number | null;
      source?: string;
    } | null;

    const cleanName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (cleanName.length < 2 || cleanName.length > 80) {
      return NextResponse.json(
        { error: 'Locality name must be between 2 and 80 characters.' },
        { status: 400 }
      );
    }

    const latVal =
      body?.lat !== null &&
      body?.lat !== undefined &&
      Number.isFinite(Number(body.lat)) &&
      Number(body.lat) >= -90 &&
      Number(body.lat) <= 90
        ? Number(body.lat)
        : null;

    const lngVal =
      body?.lng !== null &&
      body?.lng !== undefined &&
      Number.isFinite(Number(body.lng)) &&
      Number(body.lng) >= -180 &&
      Number(body.lng) <= 180
        ? Number(body.lng)
        : null;

    const rawSource =
      typeof body?.source === 'string'
        ? body.source.trim().toLowerCase()
        : 'user_submitted';
    const cleanSource = ALLOWED_SOURCES.has(rawSource)
      ? rawSource
      : 'user_submitted';

    const readClient = createServerSupabaseReadClient() || userSupabase;
    const activeHub = await resolveServiceHubByIdOrDefault(
      readClient,
      body?.hubId || null
    );

    const { data, error } = await userSupabase.rpc(
      'submit_or_resolve_locality',
      {
        p_hub_id: activeHub.id,
        p_name: cleanName,
        p_lat: latVal,
        p_lng: lngVal,
        p_source: cleanSource,
      }
    );

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Could not resolve locality.' },
        { status: 400 }
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return NextResponse.json(
        { error: 'Locality resolution returned an empty result.' },
        { status: 500 }
      );
    }

    const r = row as Record<string, unknown>;
    const locality = {
      id: String(r.id),
      hub_id: String(r.hub_id || activeHub.id),
      slug: String(r.slug || ''),
      display_name: String(r.display_name || cleanName),
      aliases: Array.isArray(r.aliases)
        ? r.aliases.map((a) => String(a)).filter(Boolean)
        : [],
      lat:
        r.lat !== null && r.lat !== undefined && Number.isFinite(Number(r.lat))
          ? Number(r.lat)
          : latVal,
      lng:
        r.lng !== null && r.lng !== undefined && Number.isFinite(Number(r.lng))
          ? Number(r.lng)
          : lngVal,
      source: String(r.source || cleanSource),
      status: String(r.status || 'pending'),
      usage_count: Number(r.usage_count ?? 1),
    };

    return NextResponse.json({ locality }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/localities/resolve] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Failed to resolve locality.' },
      { status: 500 }
    );
  }
}
