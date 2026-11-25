import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

const ALLOWED_EVENT_TYPES = new Set([
  'page_view',
  'listing_click',
  'shortcut_click',
  'search_query',
  'whatsapp_click',
  'enquiry_submit',
  'pnd_quote',
  'booking_create',
  'escrow_verified',
  'bulletin_view',
]);

const ALLOWED_DEVICE_TYPES = new Set(['mobile', 'tablet', 'desktop', 'unknown']);

const MAX_BODY_BYTES = 4096;

/**
 * Strips any accidental PII-looking tokens (emails / phone numbers) and caps length.
 */
function sanitizeToken(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  let cleaned = value.trim();
  if (!cleaned) return null;
  // Redact email addresses or 10+ digit phone sequences defensively
  cleaned = cleaned
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b\+?\d[\d\s-]{8,}\d\b/g, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, maxLen)
    .trim();
  return cleaned || null;
}

function hashSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;
  // Always normalize to a fixed-length SHA-256 hex prefix (no raw identifiers stored)
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 32);
}

/**
 * POST /api/telemetry/track
 * Lightweight, privacy-safe event ingestion for Command Center analytics.
 * Stores zero PII, validates strict event_type allow-list, and never blocks UX.
 */
export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Telemetry payload exceeds size limit.' },
        { status: 413 }
      );
    }

    const rawText = await req.text().catch(() => '');
    if (!rawText || rawText.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Invalid telemetry payload.' },
        { status: 400 }
      );
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON body.' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Expected JSON object.' },
        { status: 400 }
      );
    }

    const eventType =
      typeof body.event_type === 'string' ? body.event_type.trim() : '';
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json(
        { error: 'Unsupported event_type.' },
        { status: 400 }
      );
    }

    const rawDevice =
      typeof body.device_type === 'string'
        ? body.device_type.trim().toLowerCase()
        : 'unknown';
    const deviceType = ALLOWED_DEVICE_TYPES.has(rawDevice)
      ? rawDevice
      : 'unknown';

    const featureArea = sanitizeToken(body.feature_area, 48);
    const targetId = sanitizeToken(body.target_id, 120);
    const rootKey = sanitizeToken(body.root_key, 48);
    const locality = sanitizeToken(body.locality, 80);
    const sessionHash = hashSessionId(body.session_hash);

    // Gracefully skip if Supabase service env is unavailable in local demo mode
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        { ok: true, recorded: false },
        { status: 202, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const supabaseAdmin = createServerSupabaseAdminClient();

    // Never trust client-provided user_id; resolve ONLY from verified Bearer JWT if sent
    let verifiedUserId: string | null = null;
    const token = extractSupabaseAccessToken(req);
    if (token) {
      try {
        const { data } = await supabaseAdmin.auth.getUser(token);
        if (data?.user?.id) {
          verifiedUserId = data.user.id;
        }
      } catch {
        verifiedUserId = null;
      }
    }

    const { error } = await supabaseAdmin.from('app_analytics_events').insert({
      event_type: eventType,
      feature_area: featureArea,
      target_id: targetId,
      root_key: rootKey,
      locality,
      session_hash: sessionHash,
      user_id: verifiedUserId,
      device_type: deviceType,
    });

    if (error) {
      // Non-fatal if migration hasn't been pushed to the target project yet
      return NextResponse.json(
        { ok: true, recorded: false },
        { status: 202, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      { ok: true, recorded: true },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { ok: true, recorded: false },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
