import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

/**
 * v21a (P0-24): Contact Us persistence.
 * Validates input server-side, applies a per-email/per-IP rate limit, and inserts into
 * `public.contact_messages` with the service-role client (RLS has no client INSERT policy).
 */

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_MESSAGES_PER_WINDOW = 3;
const RATE_WINDOW_MINUTES = 15;
const ALLOWED_TOPICS = new Set([
  'Listing Verification & Support',
  'Payments, UPI & Refunds',
  'Pick N Drop & Vehicle Bookings',
  '360° Real-Estate Panorama Capture',
  'Business Catalogue Onboarding',
  'Report Map Coordinate or Boundary Issue',
]);

const ipHits = new Map<string, number[]>();

function isIpRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = RATE_WINDOW_MINUTES * 60 * 1000;
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= MAX_MESSAGES_PER_WINDOW) {
    ipHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  return false;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  // Honeypot field: bots fill hidden inputs; humans never see it
  if (typeof body.website === 'string' && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const rawTopic = String(body.topic ?? '').trim();
  const message = String(body.message ?? '').trim();
  const hubId = isUuid(body.hubId) ? body.hubId : null;

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2 || name.length > 120) {
    fieldErrors.name = 'Enter your name (2–120 characters).';
  }
  if (!EMAIL_REGEX.test(email) || email.length > 254) {
    fieldErrors.email = 'Enter a valid email address.';
  }
  if (message.length < 10 || message.length > 4000) {
    fieldErrors.message = 'Write a message of 10–4000 characters.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: 'Please fix the highlighted fields.', fieldErrors },
      { status: 422 }
    );
  }

  const topic = ALLOWED_TOPICS.has(rawTopic) ? rawTopic : 'general';
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown';

  if (isIpRateLimited(ip)) {
    return NextResponse.json(
      { error: `Too many messages. Please try again in ${RATE_WINDOW_MINUTES} minutes.` },
      { status: 429 }
    );
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = createServerSupabaseAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'Support inbox is not configured on this deployment.' },
      { status: 503 }
    );
  }

  // Durable per-email throttle (survives serverless cold starts)
  const sinceIso = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count: recentCount } = await supabaseAdmin
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .ilike('email', email)
    .gte('created_at', sinceIso);
  if ((recentCount ?? 0) >= MAX_MESSAGES_PER_WINDOW) {
    return NextResponse.json(
      { error: `Too many messages from this email. Please try again in ${RATE_WINDOW_MINUTES} minutes.` },
      { status: 429 }
    );
  }

  // Optional: attach the signed-in user (never trusted from the body)
  let userId: string | null = null;
  const token = extractSupabaseAccessToken(req);
  if (token) {
    const { data } = await supabaseAdmin.auth.getUser(token);
    userId = data?.user?.id ?? null;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('contact_messages')
    .insert({
      user_id: userId,
      hub_id: hubId,
      name,
      email,
      topic,
      message,
    })
    .select('id, created_at')
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      { error: error?.message || 'Unable to send your message right now.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: inserted.id, createdAt: inserted.created_at });
}
