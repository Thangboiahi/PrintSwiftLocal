import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_MAP_SETTINGS,
  MAP_SETTINGS_COOKIE_NAME,
  parseMapSettings,
} from '@/lib/map-settings';

function extractAccessTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const directToken =
    req.cookies.get('sb-access-token')?.value ||
    req.cookies.get('supabase-auth-token')?.value;
  if (directToken) return directToken;

  const allCookies = req.cookies.getAll();
  const sbCookie = allCookies.find(
    (c) => /^sb-.*-auth-token$/.test(c.name) && c.value
  );
  if (!sbCookie?.value) return null;

  try {
    const rawVal = sbCookie.value.startsWith('base64-')
      ? Buffer.from(sbCookie.value.slice(7), 'base64').toString('utf8')
      : decodeURIComponent(sbCookie.value);
    const parsed = JSON.parse(rawVal) as
      | { access_token?: string }
      | [string, ...unknown[]];
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return parsed[0];
    }
    if (
      parsed &&
      !Array.isArray(parsed) &&
      typeof parsed.access_token === 'string'
    ) {
      return parsed.access_token;
    }
  } catch {
    // ignore malformed cookie
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      lat?: unknown;
      lng?: unknown;
      zoom?: unknown;
      reset?: unknown;
    };

    if (body.reset === true) {
      const response = NextResponse.json({
        success: true,
        map_settings: DEFAULT_MAP_SETTINGS,
      });
      response.cookies.delete(MAP_SETTINGS_COOKIE_NAME);

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const token = extractAccessTokenFromRequest(req);

      if (supabaseUrl && supabaseKey && token) {
        try {
          const client = createClient(supabaseUrl, supabaseKey, {
            global: !process.env.SUPABASE_SERVICE_ROLE_KEY
              ? { headers: { Authorization: `Bearer ${token}` } }
              : undefined,
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const {
            data: { user },
          } = await client.auth.getUser(token);
          if (user?.id) {
            await client
              .from('profiles')
              .update({
                map_settings: DEFAULT_MAP_SETTINGS,
                updated_at: new Date().toISOString(),
              })
              .eq('id', user.id);
          }
        } catch {
          // Graceful fallback if column migration hasn't run yet
        }
      }

      return response;
    }

    const parsed = parseMapSettings({
      lat: body.lat,
      lng: body.lng,
      zoom: body.zoom ?? 13,
      configured: true,
    });

    if (!parsed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid coordinates or zoom provided.',
        },
        { status: 400 }
      );
    }

    let persistedToDatabase = false;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const token = extractAccessTokenFromRequest(req);

    if (supabaseUrl && (serviceRoleKey || anonKey) && token) {
      try {
        const authClient = createClient(
          supabaseUrl,
          anonKey || serviceRoleKey || '',
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          }
        );
        const {
          data: { user },
        } = await authClient.auth.getUser(token);

        if (user?.id) {
          const dbClient = serviceRoleKey
            ? createClient(supabaseUrl, serviceRoleKey, {
                auth: { persistSession: false, autoRefreshToken: false },
              })
            : authClient;

          const { error: updateErr } = await dbClient
            .from('profiles')
            .update({
              map_settings: parsed,
              updated_at: new Date().toISOString(),
            })
            .eq('id', user.id);

          if (!updateErr) {
            persistedToDatabase = true;
          }
        }
      } catch {
        // Keep cookie persistence intact even if DB schema lacks map_settings column
      }
    }

    const response = NextResponse.json({
      success: true,
      persistedToDatabase,
      map_settings: parsed,
    });

    response.cookies.set(MAP_SETTINGS_COOKIE_NAME, JSON.stringify(parsed), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to update map preferences.',
      },
      { status: 500 }
    );
  }
}
