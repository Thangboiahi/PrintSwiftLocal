import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import { isValidCivicIssueType } from '@/lib/verticals/types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const listingId = String(body.listingId || body.listing_id || '').trim();
    const issueType = String(body.issueType || body.issue_type || '').trim();
    const suggestedCorrection = String(
      body.suggestedCorrection || body.suggested_correction || ''
    ).trim();
    const reporterContactRaw = body.reporterContact ?? body.reporter_contact;
    const reporterContact =
      typeof reporterContactRaw === 'string' && reporterContactRaw.trim()
        ? reporterContactRaw.trim().slice(0, 120)
        : null;

    if (!UUID_REGEX.test(listingId)) {
      return NextResponse.json(
        { error: 'Valid listingId is required.' },
        { status: 400 }
      );
    }

    if (!isValidCivicIssueType(issueType)) {
      return NextResponse.json(
        { error: 'Invalid issueType supplied.' },
        { status: 400 }
      );
    }

    if (suggestedCorrection.length < 8) {
      return NextResponse.json(
        {
          error:
            'Please provide at least 8 characters describing the suggested correction.',
        },
        { status: 400 }
      );
    }

    if (suggestedCorrection.length > 1500) {
      return NextResponse.json(
        {
          error: 'Suggested correction cannot exceed 1,500 characters.',
        },
        { status: 400 }
      );
    }

    // Basic spam guard: block obvious link dumps
    const linkCount = (suggestedCorrection.match(/https?:\/\//gi) || []).length;
    if (linkCount > 2) {
      return NextResponse.json(
        { error: 'Too many links in correction note.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createServerSupabaseAdminClient();

    // Resolve optional authenticated reporter
    let reporterId: string | null = null;
    const token = extractSupabaseAccessToken(req);
    if (token) {
      const {
        data: { user },
      } = await supabaseAdmin.auth.getUser(token);
      if (user?.id) {
        reporterId = user.id;
      }
    }
    if (!reporterId) {
      const ctx = await getServerSessionContext().catch(() => null);
      if (ctx?.profile?.id) {
        reporterId = String(ctx.profile.id);
      }
    }

    // Verify listing exists and resolve hub_id
    const { data: listingRow, error: listingErr } = await supabaseAdmin
      .from('listings')
      .select('id, hub_id, title, is_civic_record, listing_vertical')
      .eq('id', listingId)
      .maybeSingle();

    if (listingErr) {
      return NextResponse.json(
        { error: `Failed to verify listing: ${listingErr.message}` },
        { status: 500 }
      );
    }

    if (!listingRow) {
      return NextResponse.json(
        { error: 'Listing not found.' },
        { status: 404 }
      );
    }

    if (
      !listingRow.is_civic_record &&
      listingRow.listing_vertical !== 'public_civic'
    ) {
      return NextResponse.json(
        {
          error:
            'Correction reports are only supported for Public & Government civic listings.',
        },
        { status: 400 }
      );
    }

    let hubId = listingRow.hub_id ? String(listingRow.hub_id) : null;
    if (!hubId) {
      const { data: defaultHub } = await supabaseAdmin
        .from('service_hubs')
        .select('id')
        .eq('is_default', true)
        .maybeSingle();
      hubId = defaultHub?.id ? String(defaultHub.id) : null;
    }

    if (!hubId) {
      return NextResponse.json(
        { error: 'Unable to resolve service hub for this civic listing.' },
        { status: 400 }
      );
    }

    // Deduplicate identical spam submission within the last 30 minutes
    const recentCutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentDuplicate } = await supabaseAdmin
      .from('civic_correction_reports')
      .select('id')
      .eq('listing_id', listingId)
      .eq('issue_type', issueType)
      .eq('suggested_correction', suggestedCorrection)
      .eq('status', 'pending')
      .gte('created_at', recentCutoffIso)
      .limit(1)
      .maybeSingle();

    if (recentDuplicate?.id) {
      return NextResponse.json(
        {
          ok: true,
          duplicate: true,
          report_id: recentDuplicate.id,
          message:
            'This correction was already reported recently and is queued for Hub Manager review.',
        },
        { status: 201 }
      );
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('civic_correction_reports')
      .insert({
        hub_id: hubId,
        listing_id: listingId,
        reporter_id: reporterId,
        reporter_contact: reporterContact,
        issue_type: issueType,
        suggested_correction: suggestedCorrection,
        status: 'pending',
      })
      .select('*')
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: `Failed to submit correction report: ${insertErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        report: inserted,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while submitting correction report.',
      },
      { status: 500 }
    );
  }
}
