import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sanitizeViewAsRoleCookie } from '@/lib/role-override';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const role = sanitizeViewAsRoleCookie(body?.role);
    const cookieStore = await cookies();

    if (role) {
      cookieStore.set('view_as_role', role, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        sameSite: 'lax',
      });
      return NextResponse.json({ success: true, role });
    } else {
      cookieStore.delete('view_as_role');
      return NextResponse.json({ success: true, role: null });
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to update view-as role cookie',
      },
      { status: 500 }
    );
  }
}
