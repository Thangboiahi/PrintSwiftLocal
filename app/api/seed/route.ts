import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

async function isSuperAdminCaller(req: NextRequest): Promise<boolean> {
  try {
    const supabaseAdmin = createServerSupabaseAdminClient();
    const token = extractSupabaseAccessToken(req);

    let userId: string | null = null;
    if (token) {
      const {
        data: { user },
      } = await supabaseAdmin.auth.getUser(token);
      if (user?.id) userId = user.id;
    }

    if (!userId) {
      const serverSession = await getServerSessionContext();
      if (serverSession.profile?.id) {
        userId = String(serverSession.profile.id);
      }
    }

    if (!userId) return false;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    return String(profile?.role || '').trim().toLowerCase() === 'super_admin';
  } catch {
    return false;
  }
}

const RETIRED_SEED_RESPONSE = {
  ok: true,
  retired: true,
  message:
    'Legacy HTTP mega-seeder has been retired in Pass R1 to protect the unified multi-vertical database from schema drift.',
  canonicalSqlSeed:
    'supabase/migrations/20261121_pass_r1b_master_wipe_and_cohesive_seed.sql',
  instruction:
    'Run supabase/migrations/20261121_pass_r1a_core_unification.sql followed by supabase/migrations/20261121_pass_r1b_master_wipe_and_cohesive_seed.sql in the Supabase SQL Editor to perform a clean, cohesive multi-hub reseed across Churachandpur & Aizawl.',
};

export async function POST(req: NextRequest) {
  const allowed = await isSuperAdminCaller(req);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Super-Admin access required.' },
      { status: 403 }
    );
  }
  return NextResponse.json(RETIRED_SEED_RESPONSE, { status: 200 });
}

export async function GET(req: NextRequest) {
  const allowed = await isSuperAdminCaller(req);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Super-Admin access required.' },
      { status: 403 }
    );
  }
  return NextResponse.json(RETIRED_SEED_RESPONSE, { status: 200 });
}
