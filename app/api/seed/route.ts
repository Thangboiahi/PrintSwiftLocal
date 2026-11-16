import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { buildMegaSeedDataset, executeMegaSeed } from '@/scripts/seed';

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) are not configured.',
      },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: bearerToken
      ? {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        }
      : undefined,
  });

  try {
    const summary = await executeMegaSeed(supabase);
    return NextResponse.json({
      ok: true,
      message: `Successfully seeded ${summary.listingsInserted} [SAMPLE] Churachandpur listings, ${summary.reviewsInserted} reviews, and ${summary.enquiriesInserted} enquiries.`,
      summary,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to execute Mega-Seeder.',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const executeParam = req.nextUrl.searchParams.get('execute');
  if (executeParam === 'true') {
    return POST(req);
  }

  const previewDataset = buildMegaSeedDataset();
  return NextResponse.json({
    ok: true,
    ready: true,
    totalPlannedListings: previewDataset.length,
    instruction:
      'Send a POST request to /api/seed (or GET /api/seed?execute=true) to populate Supabase with 56 [SAMPLE] Churachandpur listings, reviews, and enquiries.',
  });
}
