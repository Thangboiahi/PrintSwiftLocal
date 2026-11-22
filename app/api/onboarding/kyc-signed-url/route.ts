import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import { isUuid } from '@/lib/payments/types';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

const KYC_SIGNED_URL_TTL_SECONDS = 120;
const ALLOWED_KYC_BUCKETS = new Set(['kyc-documents', 'media']);

interface KycDocumentEntry {
  doc_type?: string;
  label?: string;
  storage_path?: string;
  bucket_id?: string;
  uploaded_at?: string;
}

function sanitizeStoragePath(raw: string): string | null {
  const cleaned = raw.trim().replace(/^\/+/, '');
  if (!cleaned) return null;
  // Block path traversal or control chars
  if (
    cleaned.includes('..') ||
    cleaned.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

async function resolveAuthenticatedUserId(
  req: NextRequest,
  supabaseAdmin: ReturnType<typeof createServerSupabaseAdminClient>
): Promise<string | null> {
  const token = extractSupabaseAccessToken(req);
  if (token) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data?.user?.id) {
      return data.user.id;
    }
  }

  const sessionCtx = await getServerSessionContext();
  if (sessionCtx.profile?.id) {
    return String(sessionCtx.profile.id);
  }

  return null;
}

async function handleKycSignedUrlRequest(
  req: NextRequest,
  applicationId: string,
  requestedPath: string
) {
  if (!isUuid(applicationId)) {
    return NextResponse.json(
      { error: 'Valid applicationId (UUID) is required.' },
      { status: 400 }
    );
  }

  const cleanRequestedPath = sanitizeStoragePath(requestedPath);
  if (!cleanRequestedPath) {
    return NextResponse.json(
      { error: 'Valid storagePath is required.' },
      { status: 400 }
    );
  }

  const supabaseAdmin = createServerSupabaseAdminClient();
  const userId = await resolveAuthenticatedUserId(req, supabaseAdmin);

  if (!userId) {
    return NextResponse.json(
      { error: 'Authentication required to view KYC documents.' },
      { status: 401 }
    );
  }

  // Load target application + caller's real database role (never trust client override cookies)
  const [appRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from('partner_applications')
      .select('id, applicant_id, hub_id, kyc_documents')
      .eq('id', applicationId)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  if (appRes.error || !appRes.data) {
    return NextResponse.json(
      { error: 'Partner application not found.' },
      { status: 404 }
    );
  }

  const appRow = appRes.data as {
    id: string;
    applicant_id: string;
    hub_id: string;
    kyc_documents: unknown;
  };
  const actualRole = String(profileRes.data?.role || '')
    .trim()
    .toLowerCase();

  const isApplicant = String(appRow.applicant_id) === userId;
  const isSuperAdmin = actualRole === 'super_admin';

  let isAuthorizedHubManager = false;
  if (!isApplicant && !isSuperAdmin && appRow.hub_id) {
    const { data: hmRow } = await supabaseAdmin
      .from('hub_managers')
      .select('id')
      .eq('profile_id', userId)
      .eq('hub_id', appRow.hub_id)
      .eq('is_active', true)
      .maybeSingle();

    isAuthorizedHubManager = Boolean(hmRow?.id);
  }

  if (!isApplicant && !isSuperAdmin && !isAuthorizedHubManager) {
    return NextResponse.json(
      {
        error:
          'Forbidden: Only the applicant, authorized Hub Manager for this hub, or Super-Admin may view KYC documents.',
        code: 'KYC_PRIVACY_FORBIDDEN',
      },
      { status: 403 }
    );
  }

  // Strictly match requested storage_path against documents actually attached to this application
  const docs = Array.isArray(appRow.kyc_documents)
    ? (appRow.kyc_documents as KycDocumentEntry[])
    : [];
  const matchedDoc = docs.find((entry) => {
    const entryPath =
      typeof entry?.storage_path === 'string'
        ? sanitizeStoragePath(entry.storage_path)
        : null;
    return entryPath === cleanRequestedPath;
  });

  if (!matchedDoc) {
    return NextResponse.json(
      {
        error:
          'Requested KYC document is not attached to this partner application.',
        code: 'KYC_DOCUMENT_NOT_FOUND',
      },
      { status: 404 }
    );
  }

  const rawBucket = String(matchedDoc.bucket_id || 'kyc-documents').trim();
  const bucketId = ALLOWED_KYC_BUCKETS.has(rawBucket)
    ? rawBucket
    : 'kyc-documents';

  // Confirm document has not been purged in media_assets
  const { data: assetRow } = await supabaseAdmin
    .from('media_assets')
    .select('status, purged_at')
    .eq('storage_path', cleanRequestedPath)
    .maybeSingle();

  if (
    assetRow &&
    (assetRow.status === 'purged' || assetRow.purged_at !== null)
  ) {
    return NextResponse.json(
      {
        error:
          'This KYC document has been permanently purged after its retention window.',
        code: 'KYC_DOCUMENT_PURGED',
      },
      { status: 410 }
    );
  }

  const { data: signedData, error: signedErr } = await supabaseAdmin.storage
    .from(bucketId)
    .createSignedUrl(cleanRequestedPath, KYC_SIGNED_URL_TTL_SECONDS);

  if (signedErr || !signedData?.signedUrl) {
    return NextResponse.json(
      {
        error:
          signedErr?.message ||
          'Failed to generate temporary signed URL for KYC document.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      signedUrl: signedData.signedUrl,
      expiresInSeconds: KYC_SIGNED_URL_TTL_SECONDS,
      bucketId,
      storagePath: cleanRequestedPath,
      docType: matchedDoc.doc_type || 'kyc_document',
      label: matchedDoc.label || 'KYC Document',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, private, max-age=0',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      applicationId?: string;
      application_id?: string;
      storagePath?: string;
      storage_path?: string;
    } | null;

    const applicationId = String(
      body?.applicationId || body?.application_id || ''
    ).trim();
    const storagePath = String(
      body?.storagePath || body?.storage_path || ''
    ).trim();

    return await handleKycSignedUrlRequest(req, applicationId, storagePath);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while signing KYC document URL.',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const applicationId = String(
      params.get('applicationId') || params.get('application_id') || ''
    ).trim();
    const storagePath = String(
      params.get('storagePath') || params.get('storage_path') || ''
    ).trim();

    return await handleKycSignedUrlRequest(req, applicationId, storagePath);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while signing KYC document URL.',
      },
      { status: 500 }
    );
  }
}
