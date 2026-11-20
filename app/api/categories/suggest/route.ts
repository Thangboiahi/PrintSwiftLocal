import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { extractSupabaseAccessToken } from '@/lib/pick-n-drop/fare';
import type { CategoryEntityType } from '@/lib/config/types';

export const dynamic = 'force-dynamic';

const VALID_ENTITY_TYPES = new Set<CategoryEntityType>([
  'listing',
  'product',
  'bulletin',
  'vehicle',
]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeOptionalUuid(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

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
        { error: 'Authentication required to suggest a subcategory.' },
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
      entityType?: string;
      parentCategoryId?: string | null;
      suggestedName?: string;
      hubId?: string | null;
      linkedEntityId?: string | null;
    } | null;

    const rawEntityType = String(body?.entityType || '')
      .trim()
      .toLowerCase() as CategoryEntityType;
    if (!VALID_ENTITY_TYPES.has(rawEntityType)) {
      return NextResponse.json(
        {
          error:
            'Invalid entityType. Expected one of: listing, product, bulletin, vehicle.',
        },
        { status: 400 }
      );
    }

    const cleanSuggestedName =
      typeof body?.suggestedName === 'string'
        ? body.suggestedName.trim().replace(/\s+/g, ' ')
        : '';

    if (cleanSuggestedName.length < 2 || cleanSuggestedName.length > 60) {
      return NextResponse.json(
        { error: 'Suggested category name must be between 2 and 60 characters.' },
        { status: 400 }
      );
    }

    const normalizedTag = cleanSuggestedName.toLowerCase();
    const parentCategoryId = sanitizeOptionalUuid(body?.parentCategoryId);
    const hubId = sanitizeOptionalUuid(body?.hubId);
    const linkedEntityId = sanitizeOptionalUuid(body?.linkedEntityId);

    const { data, error } = await userSupabase
      .from('category_suggestions')
      .insert({
        entity_type: rawEntityType,
        parent_category_id: parentCategoryId,
        suggested_name: cleanSuggestedName,
        normalized_name: normalizedTag,
        hub_id: hubId,
        submitted_by: user.id,
        linked_entity_id: linkedEntityId,
        status: 'pending',
      })
      .select(
        'id, entity_type, parent_category_id, suggested_name, normalized_name, hub_id, linked_entity_id, status, created_at'
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Could not submit category suggestion.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        suggestion: data,
        normalizedTag,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/categories/suggest] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Failed to submit category suggestion.' },
      { status: 500 }
    );
  }
}
