import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  EMAIL_REGEX,
  OTP_REGEX,
  PASSWORD_REGEX,
  USERNAME_REGEX,
  PHONE_REGEX,
  formatUsername,
  formatPhone,
  getPasswordStrength,
  resolveInitialRole,
} from '@/lib/validators';
import { verifySignedOtpToken } from '@/lib/otp-token';
import { getPublicSupabaseConfig } from '@/lib/env';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      otp?: string;
      verificationToken?: string;
      password?: string;
      username?: string;
      full_name?: string;
      phone?: string;
      avatar_url?: string | null;
      bio?: string | null;
      social_links?: Record<string, string> | null;
      referral_code?: string | null;
      hub_id?: string | null;
    };

    const cleanEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const cleanOtp = String(body?.otp || '').trim();
    const verificationToken = String(body?.verificationToken || '').trim();
    const password = String(body?.password || '');
    const username = formatUsername(String(body?.username || ''));
    const full_name = String(body?.full_name || '').trim();
    const phone = formatPhone(String(body?.phone || ''));
    const avatar_url = body?.avatar_url ? String(body.avatar_url).trim() : null;
    const bio = body?.bio ? String(body.bio).trim() : null;
    const social_links =
      body?.social_links && typeof body.social_links === 'object'
        ? body.social_links
        : {};
    const referralCode = String(body?.referral_code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    const referralHubId = body?.hub_id ? String(body.hub_id).trim() : null;

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

    // 1. Verify { email, otp, verificationToken } using verifySignedOtpToken
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

    // Validate password against PASSWORD_REGEX
    const strength = getPasswordStrength(password);
    if (!PASSWORD_REGEX.test(password) || !strength.isValid) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
        },
        { status: 400 }
      );
    }

    if (!USERNAME_REGEX.test(username)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Username must be 3–20 characters using only lowercase letters, numbers, and underscores.',
        },
        { status: 400 }
      );
    }

    if (full_name.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please enter your full name (at least 2 characters).',
        },
        { status: 400 }
      );
    }

    if (!PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please enter a valid mobile number with country code.',
        },
        { status: 400 }
      );
    }

    // 2. Create standard Supabase client with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
    const { url: publicUrl, anonKey: publicAnonKey } = getPublicSupabaseConfig();
    const supabaseUrl = publicUrl || process.env.SUPABASE_URL;
    const supabaseAnonKey = publicAnonKey || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing Supabase configuration on the server.',
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

    // 3. Call SECURITY DEFINER Postgres RPC using the standard anon client (bypasses Supabase signup mailer)
    const { data: userId, error } = await supabase.rpc(
      'create_verified_user_and_profile',
      {
        p_email: cleanEmail,
        p_password: password,
        p_username: username,
        p_full_name: full_name,
        p_phone: phone,
        p_avatar_url: avatar_url || null,
        p_bio: bio || null,
        p_social_links: social_links || {},
      }
    );

    if (error) {
      if (
        error.code === '23505' ||
        error.message?.toLowerCase().includes('username')
      ) {
        return NextResponse.json(
          {
            success: false,
            code: '23505',
            error:
              'That username is already taken. Please choose another username.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    const role = resolveInitialRole(cleanEmail);

    // Claim temporary uploads in media_assets and optionally apply referral code
    let referralApplied = false;
    if (userId) {
      try {
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceRoleKey) {
          const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          });

          if (avatar_url) {
            await supabaseAdmin
              .from('media_assets')
              .update({ entity_id: userId, is_temporary: false })
              .eq('public_url', avatar_url);
          }

          if (referralCode && referralCode.length >= 4 && referralCode.length <= 24) {
            const { data: referrerRow } = await supabaseAdmin
              .from('profiles')
              .select('id')
              .ilike('referral_code', referralCode)
              .maybeSingle();

            if (referrerRow?.id && referrerRow.id !== userId) {
              const { data: cfgRow } = await supabaseAdmin
                .from('platform_settings')
                .select('value')
                .eq('key', 'onboarding_and_referrals')
                .maybeSingle();
              const cfgVal = (cfgRow?.value || {}) as Record<string, unknown>;
              const rewardInr = Number(cfgVal.user_referral_reward_inr ?? 50);

              await supabaseAdmin
                .from('profiles')
                .update({
                  referred_by_user_id: referrerRow.id,
                  referral_applied_at: new Date().toISOString(),
                })
                .eq('id', userId)
                .is('referred_by_user_id', null);

              const { error: refInsertErr } = await supabaseAdmin
                .from('referrals')
                .insert({
                  referrer_user_id: referrerRow.id,
                  referred_user_id: userId,
                  hub_id: referralHubId || null,
                  referral_type: 'user_signup',
                  status: 'pending',
                  reward_amount_inr: Number.isFinite(rewardInr) ? rewardInr : 50,
                });

              if (!refInsertErr) {
                referralApplied = true;
              }
            }
          }
        }
      } catch (claimErr) {
        console.warn('Notice: non-fatal post-signup hook error:', claimErr);
      }
    }

    return NextResponse.json({
      success: true,
      userId,
      role,
      referralApplied,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected server error while completing signup.',
      },
      { status: 500 }
    );
  }
}
