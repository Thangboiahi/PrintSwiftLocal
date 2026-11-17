import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EMAIL_REGEX, OTP_REGEX, PASSWORD_REGEX } from '@/lib/validators';
import { verifySignedOtpToken } from '@/lib/otp-token';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      otp?: string;
      verificationToken?: string;
      newPassword?: string;
    };

    const cleanEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(body?.otp || '').trim();
    const verificationToken = String(body?.verificationToken || '').trim();
    const newPassword = String(body?.newPassword || '');

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return NextResponse.json(
        { success: false, error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    if (!OTP_REGEX.test(cleanOtp)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Incorrect 6-digit code. Please check your email and try again.',
        },
        { status: 400 }
      );
    }

    const otpCheck = verifySignedOtpToken(
      verificationToken,
      cleanEmail,
      cleanOtp
    );
    if (!otpCheck.valid) {
      return NextResponse.json(
        {
          success: false,
          error:
            otpCheck.reason ||
            'Verification code expired. Please click Resend Code.',
        },
        { status: 400 }
      );
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'New password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY on the server.',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { error } = await supabase.rpc('reset_verified_password', {
      p_email: cleanEmail,
      p_new_password: newPassword,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected server error while resetting password.',
      },
      { status: 500 }
    );
  }
}
