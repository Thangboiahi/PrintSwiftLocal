import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import {
  EMAIL_REGEX,
  OTP_REGEX,
  PASSWORD_REGEX,
  formatOtp,
} from '@/lib/validators';

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Supabase server credentials are missing. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured.'
    );
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
      : 'Verify Your PrintSwift Local Email';
  const subtext =
    mode === 'recovery'
      ? 'Use the 6-digit verification code below to reset your PrintSwift Local account password.'
      : 'Use the 6-digit verification code below to complete your PrintSwift Local registration.';

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
                  PrintSwift Local · Churachandpur
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
                  This code expires in <strong>10 minutes</strong>. If you did not request this code, you can safely ignore this email.
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

    const normalizedEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const mode: 'signup' | 'recovery' =
      body?.mode === 'recovery' ? 'recovery' : 'signup';

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
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
    if (mode === 'signup') {
      const { data: existingProfile, error: profileQueryError } =
        await supabaseAdmin
          .from('profiles')
          .select('id, email')
          .ilike('email', normalizedEmail)
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
    }

    // Generate random 6-digit OTP code and 10-minute expiration timestamp
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Store OTP in public.email_otps via service role client (with SECURITY DEFINER RPC fallback)
    const { error: upsertError } = await supabaseAdmin
      .from('email_otps')
      .upsert(
        {
          email: normalizedEmail,
          otp,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      );

    if (upsertError) {
      const { error: rpcError } = await supabaseAdmin.rpc('upsert_email_otp', {
        p_email: normalizedEmail,
        p_otp: otp,
        p_expires_at: expiresAt,
      });

      if (rpcError) {
        return NextResponse.json(
          {
            success: false,
            error: `Failed to store verification code: ${upsertError.message}`,
          },
          { status: 500 }
        );
      }
    }

    // Deliver the 6-digit OTP via Resend HTTP API
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
      'PrintSwift Local <onboarding@resend.dev>';

    const { error: resendError } = await resend.emails.send({
      from: fromAddress,
      to: [normalizedEmail],
      subject:
        mode === 'recovery'
          ? `${otp} is your PrintSwift Local recovery code`
          : `${otp} is your PrintSwift Local verification code`,
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

    return NextResponse.json({ success: true });
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
      consume?: boolean;
      newPassword?: string;
    };

    const normalizedEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const cleanedOtp = formatOtp(String(body?.otp || ''));
    const shouldConsume = Boolean(body?.consume);

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json(
        { success: false, error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    if (!OTP_REGEX.test(cleanedOtp)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please enter a valid 6-digit verification code.',
        },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Check public.email_otps table directly via service role client
    const { data: otpRow, error: selectError } = await supabaseAdmin
      .from('email_otps')
      .select('email, otp, expires_at')
      .eq('email', normalizedEmail)
      .maybeSingle();

    let isOtpValid = false;

    if (!selectError && otpRow) {
      const expiresAtMs = new Date(String(otpRow.expires_at)).getTime();
      if (
        String(otpRow.otp).trim() === cleanedOtp &&
        Number.isFinite(expiresAtMs) &&
        expiresAtMs > Date.now()
      ) {
        isOtpValid = true;
      }
    } else {
      // Fallback to SECURITY DEFINER RPC verification
      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
        'verify_email_otp',
        {
          p_email: normalizedEmail,
          p_otp: cleanedOtp,
          p_consume: false,
        }
      );

      if (!rpcError && rpcResult === true) {
        isOtpValid = true;
      }
    }

    if (!isOtpValid) {
      return NextResponse.json(
        {
          success: false,
          error:
            'The verification code is invalid or has expired. Please request a new 6-digit code.',
        },
        { status: 400 }
      );
    }

    // Optional server-side password update for Recovery Step 2 when service role key is present
    if (body?.newPassword) {
      if (!PASSWORD_REGEX.test(body.newPassword)) {
        return NextResponse.json(
          {
            success: false,
            error: 'New password does not meet security requirements.',
          },
          { status: 400 }
        );
      }

      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const { data: usersList, error: listError } =
          await supabaseAdmin.auth.admin.listUsers();
        if (!listError && usersList?.users) {
          const matchedUser = usersList.users.find(
            (u) => u.email?.toLowerCase() === normalizedEmail
          );
          if (matchedUser) {
            const { error: updateErr } =
              await supabaseAdmin.auth.admin.updateUserById(matchedUser.id, {
                password: body.newPassword,
              });
            if (updateErr) {
              return NextResponse.json(
                { success: false, error: updateErr.message },
                { status: 500 }
              );
            }
          }
        }
      }
    }

    if (shouldConsume || Boolean(body?.newPassword)) {
      await supabaseAdmin
        .from('email_otps')
        .delete()
        .eq('email', normalizedEmail);
      await supabaseAdmin.rpc('verify_email_otp', {
        p_email: normalizedEmail,
        p_otp: cleanedOtp,
        p_consume: true,
      });
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
