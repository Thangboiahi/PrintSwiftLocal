import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');

  if (code && isSupabaseConfigured()) {
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      // Ignore exchange failures and fall back to root redirect
    }
  }

  return NextResponse.redirect(new URL('/', request.url));
}
