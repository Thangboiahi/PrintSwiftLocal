import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { EMAIL_REGEX, OTP_REGEX } from '@/lib/validators';
import { createSignedOtpToken, verifySignedOtpToken } from '@/lib/otp-token';

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildOtpEmailHtml(code: string, mode: 'signup' | 'recovery'): string {
  const heading =
    mode === 'recovery'
      ? 'Password Recovery Verification Code'
      : 'Verify Your DD oodle Email';
  const subtext =
    mode === 'recovery'
      ? 'Use the 6-digit verification code below to reset your DD oodle account password.'
      : 'Use the 6-digit verification code below to complete your DD oodle registration.';

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f8fafc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:480px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px 24px;text-align:center;">
            <tr>
              <td>
                <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#0284c7;margin-bottom:8px;">
                  DD oodle · Churachandpur
                </div>
                <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:#0f172a;">
                  ${heading}
                </h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#475569;">
                  ${subtext}
                </p>
                <div style="margin:0 auto 24px auto;padding:18px 24px;background-color:#f1f5f9;border:1px solid #cbd5e1;border-radius:12px;display:inline-block;">
                  <span style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a;">
                    ${code}
                  </span>
                </div>
                <p style="margin:0;font-size:12px;color:#64748b;">
                  This code expires in <strong>15 minutes</strong>. If you did not request this code, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      mode?: 'signup' | 'recovery';
    };

    const cleanEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const mode: 'signup' | 'recovery' =
      body?.mode === 'recovery' ? 'recovery' : 'signup';

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please provide a valid email address.',
        },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Check if the email already exists in public.profiles when in sign-up mode
    if (mode === 'signup' && supabaseAdmin) {
      try {
        const { data: existingProfile, error: profileQueryError } =
          await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (!profileQueryError && existingProfile) {
          return NextResponse.json(
            {
              success: false,
              error:
                'An account with this email is already registered. Please sign in or use Forgot Password to recover access.',
            },
            { status: 409 }
          );
        }
      } catch {
        // Non-blocking if profiles check fails
      }
    }

    // Generate random 6-digit OTP code and 15-minute expiration timestamp
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Best-effort optional DB persistence (never block or fail if email_otps upsert errors)
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from('email_otps').upsert(
          {
            email: cleanEmail,
            otp,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'email' }
        );
      } catch {
        // Ignore DB upsert failure; stateless HMAC verificationToken is authoritative
      }
    }

    const resendApiKey = process.env.RESEND_API_KEY || '';
    if (!resendApiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Email delivery service (RESEND_API_KEY) is not configured on the server.',
        },
        { status: 500 }
      );
    }

    const resend = new Resend(resendApiKey);
    const fromAddress =
      process.env.RESEND_FROM_EMAIL ||
      'DD oodle <onboarding@resend.dev>';

    const { error: resendError } = await resend.emails.send({
      from: fromAddress,
      to: [cleanEmail],
      subject:
        mode === 'recovery'
          ? `${otp} is your DD oodle recovery code`
          : `${otp} is your DD oodle verification code`,
      html: buildOtpEmailHtml(otp, mode),
    });

    if (resendError) {
      return NextResponse.json(
        {
          success: false,
          error:
            resendError.message ||
            'Failed to send verification email via Resend.',
        },
        { status: 502 }
      );
    }

    const verificationToken = createSignedOtpToken(cleanEmail, otp);

    return NextResponse.json({
      success: true,
      verificationToken,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected server error while sending verification code.',
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
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

    const result = verifySignedOtpToken(verificationToken, cleanEmail, cleanOtp);
    if (!result.valid) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.reason ||
            'Verification code expired. Please click Resend Code.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, verified: true });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to verify the 6-digit code.',
      },
      { status: 500 }
    );
  }
}
