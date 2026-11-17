import { NextRequest, NextResponse } from 'next/server';
import { EMAIL_REGEX, OTP_REGEX } from '@/lib/validators';
import { verifySignedOtpToken } from '@/lib/otp-token';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      otp?: string;
      verificationToken?: string;
    };

    const cleanEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(body?.otp || '').trim();
    const verificationToken = String(body?.verificationToken || '').trim();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return NextResponse.json(
        { verified: false, error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    if (!OTP_REGEX.test(cleanOtp)) {
      return NextResponse.json(
        {
          verified: false,
          error:
            'Incorrect 6-digit code. Please check your email and try again.',
        },
        { status: 400 }
      );
    }

    const result = verifySignedOtpToken(verificationToken, cleanEmail, cleanOtp);
    if (!result.valid) {
      return NextResponse.json(
        {
          verified: false,
          error:
            result.reason ||
            'Verification code expired. Please click Resend Code.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ verified: true, success: true });
  } catch (err) {
    return NextResponse.json(
      {
        verified: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected server error while verifying OTP.',
      },
      { status: 500 }
    );
  }
}
