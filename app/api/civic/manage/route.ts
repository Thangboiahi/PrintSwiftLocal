import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import {
  type CivicDepartmentType,
  type CivicDocumentChecklist,
  type CivicHelpline,
  isValidCivicDepartmentType,
} from '@/lib/verticals/types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEPARTMENT_TO_CATEGORY_SLUG: Record<CivicDepartmentType, string> = {
  emergency_medical: 'emergency_hospitals',
  police_fire: 'police_fire_rescue',
  government_office: 'govt_civic_offices',
  utility_power_water: 'utilities_power_water',
  public_transport_hub: 'community_public_places',
  community_religious: 'community_public_places',
  education_public: 'govt_civic_offices',
};

const DEPARTMENT_SUBCATEGORY_LABEL: Record<CivicDepartmentType, string> = {
  emergency_medical: 'Emergency & Hospitals',
  police_fire: 'Police, Fire & Rescue',
  government_office: 'Government Offices',
  utility_power_water: 'Electricity & Water',
  public_transport_hub: 'Public Transport Hub',
  community_religious: 'Community & Public Halls',
  education_public: 'Public Education',
};

interface CivicActor {
  userId: string;
  actualRole: string;
  fullName: string | null;
}

async function authenticateCivicManager(
  req: NextRequest,
  supabaseAdmin: SupabaseClient
): Promise<CivicActor | null> {
  let userId: string | null = null;
  const token = extractSupabaseAccessToken(req);

  if (token) {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (!error && user?.id) {
      userId = user.id;
    }
  }

  if (!userId) {
    const ctx = await getServerSessionContext().catch(() => null);
    if (ctx?.profile?.id) {
      userId = String(ctx.profile.id);
    }
  }

  if (!userId) return null;

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, name')
    .eq('id', userId)
    .maybeSingle();

  if (profErr || !profile) return null;

  const actualRole = String(profile.role || 'visitor')
    .trim()
    .toLowerCase();

  return {
    userId: String(profile.id),
    actualRole,
    fullName:
      (typeof profile.full_name === 'string' && profile.full_name) ||
      (typeof profile.name === 'string' && profile.name) ||
      null,
  };
}

/**
 * Mirrors DB `public.can_manage_civic_hub(p_hub_id)` strictly:
 * Returns true ONLY for super_admin, admin, active hub_manager for hubId,
 * or active civic staff with explicit `manage_civic` delegation for hubId.
 */
async function canActorManageCivicHub(
  supabaseAdmin: SupabaseClient,
  actor: CivicActor,
  hubId: string
): Promise<boolean> {
  if (!hubId || !UUID_REGEX.test(hubId)) return false;
  if (actor.actualRole === 'super_admin' || actor.actualRole === 'admin') {
    return true;
  }

  const { data: hmRow } = await supabaseAdmin
    .from('hub_managers')
    .select('id')
    .eq('profile_id', actor.userId)
    .eq('hub_id', hubId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (hmRow?.id) {
    return true;
  }

  // Check active civic staff delegation
  const { data: delegations } = await supabaseAdmin
    .from('staff_delegations')
    .select('listing_id, permissions, status')
    .eq('staff_id', actor.userId);

  if (!Array.isArray(delegations) || delegations.length === 0) {
    return false;
  }

  const civicListingIds = delegations
    .filter((d) => {
      if (d.status && d.status !== 'active') return false;
      const perms = d.permissions;
      if (Array.isArray(perms)) return perms.includes('manage_civic');
      if (perms && typeof perms === 'object') {
        return Boolean((perms as Record<string, unknown>).manage_civic);
      }
      return false;
    })
    .map((d) => String(d.listing_id || ''))
    .filter((id) => UUID_REGEX.test(id));

  if (civicListingIds.length === 0) return false;

  const { data: matchingListing } = await supabaseAdmin
    .from('listings')
    .select('id')
    .in('id', civicListingIds)
    .eq('hub_id', hubId)
    .eq('is_civic_record', true)
    .limit(1)
    .maybeSingle();

  return Boolean(matchingListing?.id);
}

function sanitizeHelplines(raw: unknown): CivicHelpline[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: CivicHelpline[] = [];
  for (const item of raw.slice(0, 15)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = String(obj.label || '').trim().slice(0, 80);
    const phone = String(obj.phone || '').trim().slice(0, 32);
    if (!label || !phone) continue;
    cleaned.push({
      label,
      phone,
      is_emergency: Boolean(obj.is_emergency),
      whatsapp: Boolean(obj.whatsapp),
    });
  }
  return cleaned;
}

function sanitizeDocumentChecklists(raw: unknown): CivicDocumentChecklist[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: CivicDocumentChecklist[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const serviceTitle = String(obj.service_title || '').trim().slice(0, 140);
    if (!serviceTitle) continue;
    const docs = Array.isArray(obj.required_docs)
      ? obj.required_docs
          .map((d) => String(d || '').trim().slice(0, 180))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    cleaned.push({
      service_title: serviceTitle,
      required_docs: docs,
      fee_note:
        typeof obj.fee_note === 'string' && obj.fee_note.trim()
          ? obj.fee_note.trim().slice(0, 160)
          : null,
      processing_time:
        typeof obj.processing_time === 'string' && obj.processing_time.trim()
          ? obj.processing_time.trim().slice(0, 120)
          : null,
    });
  }
  return cleaned;
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = createServerSupabaseAdminClient();
    const actor = await authenticateCivicManager(req, supabaseAdmin);
    if (!actor) {
      return NextResponse.json(
        { error: 'Unauthorized: Sign in required.' },
        { status: 401 }
      );
    }

    let hubId = (req.nextUrl.searchParams.get('hubId') || '').trim();
    const isAdminGlobal =
      actor.actualRole === 'super_admin' || actor.actualRole === 'admin';
    const isAllHubsRequest =
      hubId.toLowerCase() === 'all' || (!hubId && isAdminGlobal);

    if (isAllHubsRequest) {
      if (!isAdminGlobal) {
        return NextResponse.json(
          {
            error:
              'Forbidden: Only administrators may query civic records across all hubs.',
          },
          { status: 403 }
        );
      }
      hubId = 'all';
    } else {
      if (!UUID_REGEX.test(hubId)) {
        return NextResponse.json(
          { error: 'Valid hubId query parameter is required.' },
          { status: 400 }
        );
      }

      const allowed = await canActorManageCivicHub(supabaseAdmin, actor, hubId);
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              'Forbidden: Only authorized hub managers, civic staff, or administrators may manage civic records.',
          },
          { status: 403 }
        );
      }
    }

    let listingsQuery = supabaseAdmin
      .from('listings')
      .select(
        'id, hub_id, title, category, subcategory, category_id, status, locality, address, short_description, description, contact_phone, phone, lat, lng, coordinates, cover_image, listing_vertical, is_civic_record, vertical_summary, created_at, updated_at'
      )
      .or('is_civic_record.eq.true,listing_vertical.eq.public_civic')
      .order('title', { ascending: true })
      .limit(300);

    let profilesQuery = supabaseAdmin
      .from('listing_civic_profiles')
      .select('*')
      .limit(300);

    let reportsQuery = supabaseAdmin
      .from('civic_correction_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (hubId !== 'all') {
      listingsQuery = listingsQuery.eq('hub_id', hubId);
      profilesQuery = profilesQuery.eq('hub_id', hubId);
      reportsQuery = reportsQuery.eq('hub_id', hubId);
    }

    const [listingsRes, profilesRes, reportsRes] = await Promise.all([
      listingsQuery,
      profilesQuery,
      reportsQuery,
    ]);

    if (listingsRes.error) {
      return NextResponse.json(
        { error: `Failed to fetch civic listings: ${listingsRes.error.message}` },
        { status: 500 }
      );
    }
    if (profilesRes.error) {
      return NextResponse.json(
        { error: `Failed to fetch civic profiles: ${profilesRes.error.message}` },
        { status: 500 }
      );
    }
    if (reportsRes.error) {
      return NextResponse.json(
        {
          error: `Failed to fetch civic correction reports: ${reportsRes.error.message}`,
        },
        { status: 500 }
      );
    }

    const profileMap = new Map<string, Record<string, unknown>>();
    for (const p of profilesRes.data || []) {
      profileMap.set(String(p.listing_id), p as Record<string, unknown>);
    }

    const listingTitleMap = new Map<string, string>();
    const civicListings = (listingsRes.data || []).map((l) => {
      const id = String(l.id);
      listingTitleMap.set(id, String(l.title || ''));
      return {
        ...l,
        civic_profile: profileMap.get(id) || null,
      };
    });

    const correctionReports = (reportsRes.data || [])
      .map((r) => ({
        ...r,
        listing_title:
          listingTitleMap.get(String(r.listing_id)) ||
          `Civic Listing ${String(r.listing_id).slice(0, 8)}`,
      }))
      .sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return (
          new Date(String(b.created_at || 0)).getTime() -
          new Date(String(a.created_at || 0)).getTime()
        );
      });

    return NextResponse.json({
      ok: true,
      hub_id: hubId,
      civic_listings: civicListings,
      correction_reports: correctionReports,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error loading civic governance data.',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createServerSupabaseAdminClient();
    const actor = await authenticateCivicManager(req, supabaseAdmin);
    if (!actor) {
      return NextResponse.json(
        { error: 'Unauthorized: Sign in required.' },
        { status: 401 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const action = String(body.action || '').trim();
    const nowIso = new Date().toISOString();

    // -------------------------------------------------------------------------
    // ACTION 1: upsert_civic_listing
    // -------------------------------------------------------------------------
    if (action === 'upsert_civic_listing') {
      const listingId =
        typeof body.listingId === 'string' && body.listingId.trim()
          ? body.listingId.trim()
          : typeof body.listing_id === 'string' && body.listing_id.trim()
            ? body.listing_id.trim()
            : null;

      if (listingId && !UUID_REGEX.test(listingId)) {
        return NextResponse.json(
          { error: 'Invalid listingId format.' },
          { status: 400 }
        );
      }

      let hubId = String(body.hubId || body.hub_id || '').trim();
      if (listingId && !hubId) {
        const { data: existingListing } = await supabaseAdmin
          .from('listings')
          .select('hub_id')
          .eq('id', listingId)
          .maybeSingle();
        if (existingListing?.hub_id) {
          hubId = String(existingListing.hub_id);
        }
      }

      if (!UUID_REGEX.test(hubId)) {
        return NextResponse.json(
          { error: 'Valid hubId is required.' },
          { status: 400 }
        );
      }

      const allowed = await canActorManageCivicHub(supabaseAdmin, actor, hubId);
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              'Forbidden: You do not have civic management privileges for this hub.',
          },
          { status: 403 }
        );
      }

      const title = String(body.title || '').trim().slice(0, 160);
      if (title.length < 3) {
        return NextResponse.json(
          { error: 'Title must be at least 3 characters.' },
          { status: 400 }
        );
      }

      const rawDept = String(
        body.departmentType || body.department_type || 'government_office'
      ).trim();
      const departmentType: CivicDepartmentType = isValidCivicDepartmentType(
        rawDept
      )
        ? rawDept
        : 'government_office';

      const locality = String(body.locality || '').trim().slice(0, 120) || null;
      const address = String(body.address || '').trim().slice(0, 320) || null;
      const shortDescription =
        String(body.shortDescription || body.short_description || '')
          .trim()
          .slice(0, 300) || null;
      const description =
        String(body.description || shortDescription || title)
          .trim()
          .slice(0, 2000) || null;

      const helplines = sanitizeHelplines(body.helplines);
      const documentChecklists = sanitizeDocumentChecklists(
        body.documentChecklists ?? body.document_checklists
      );

      const primaryPhoneFromHelplines =
        helplines.find((h) => h.is_emergency)?.phone ||
        helplines[0]?.phone ||
        null;
      const contactPhone =
        String(body.contactPhone || body.contact_phone || '').trim().slice(0, 32) ||
        primaryPhoneFromHelplines;

      const latNum = Number(body.lat);
      const lngNum = Number(body.lng);
      const hasValidCoords =
        Number.isFinite(latNum) &&
        Number.isFinite(lngNum) &&
        latNum >= -90 &&
        latNum <= 90 &&
        lngNum >= -180 &&
        lngNum <= 180;

      let resolvedLat = hasValidCoords ? latNum : null;
      let resolvedLng = hasValidCoords ? lngNum : null;
      if (resolvedLat === null || resolvedLng === null) {
        const { data: hubCoords } = await supabaseAdmin
          .from('service_hubs')
          .select('center_lat, center_lng')
          .eq('id', hubId)
          .maybeSingle();
        resolvedLat = Number(hubCoords?.center_lat || 24.3333);
        resolvedLng = Number(hubCoords?.center_lng || 93.6833);
      }

      // Resolve category_id for the civic department
      const targetSlug = DEPARTMENT_TO_CATEGORY_SLUG[departmentType];
      const { data: catRow } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('entity_type', 'listing')
        .in('slug', [targetSlug, 'public_govt_services'])
        .order('depth', { ascending: false })
        .limit(1)
        .maybeSingle();

      const statusRaw = String(body.status || 'published').trim().toLowerCase();
      const status = ['published', 'draft', 'archived'].includes(statusRaw)
        ? statusRaw
        : 'published';

      const coverImage =
        typeof body.coverImage === 'string' && body.coverImage.trim()
          ? body.coverImage.trim().slice(0, 500)
          : typeof body.cover_image === 'string' && body.cover_image.trim()
            ? body.cover_image.trim().slice(0, 500)
            : null;

      let savedListing: Record<string, unknown> | null = null;

      if (listingId) {
        // Ensure existing listing belongs to the same hub before updating
        const { data: existing } = await supabaseAdmin
          .from('listings')
          .select('id, hub_id')
          .eq('id', listingId)
          .maybeSingle();

        if (!existing) {
          return NextResponse.json(
            { error: 'Civic listing not found.' },
            { status: 404 }
          );
        }
        if (existing.hub_id && String(existing.hub_id) !== hubId) {
          const canManageOldHub = await canActorManageCivicHub(
            supabaseAdmin,
            actor,
            String(existing.hub_id)
          );
          if (!canManageOldHub) {
            return NextResponse.json(
              { error: 'Forbidden: Cross-hub modification denied.' },
              { status: 403 }
            );
          }
        }

        const updatePayload: Record<string, unknown> = {
          hub_id: hubId,
          title,
          category: 'public_interest',
          subcategory: DEPARTMENT_SUBCATEGORY_LABEL[departmentType],
          status,
          locality,
          address,
          short_description: shortDescription,
          description,
          contact_phone: contactPhone,
          phone: contactPhone,
          lat: resolvedLat,
          lng: resolvedLng,
          coordinates: { lat: resolvedLat, lng: resolvedLng },
          listing_vertical: 'public_civic',
          is_civic_record: true,
          updated_at: nowIso,
        };
        if (catRow?.id) updatePayload.category_id = catRow.id;
        if (coverImage !== null) updatePayload.cover_image = coverImage;

        const { data: updated, error: updErr } = await supabaseAdmin
          .from('listings')
          .update(updatePayload)
          .eq('id', listingId)
          .select('*')
          .single();

        if (updErr) {
          return NextResponse.json(
            { error: `Failed to update civic listing: ${updErr.message}` },
            { status: 500 }
          );
        }
        savedListing = updated as Record<string, unknown>;
      } else {
        const insertPayload: Record<string, unknown> = {
          owner_id: actor.userId,
          owner_name: 'DD oodle Civic Directory',
          hub_id: hubId,
          title,
          category: 'public_interest',
          subcategory: DEPARTMENT_SUBCATEGORY_LABEL[departmentType],
          category_id: catRow?.id || null,
          status,
          locality,
          address,
          short_description: shortDescription,
          description,
          price: 0,
          contact_phone: contactPhone,
          phone: contactPhone,
          cover_image: coverImage,
          gallery_images: [],
          lat: resolvedLat,
          lng: resolvedLng,
          coordinates: { lat: resolvedLat, lng: resolvedLng },
          rating: 0,
          review_count: 0,
          listing_vertical: 'public_civic',
          is_civic_record: true,
        };

        const { data: inserted, error: insErr } = await supabaseAdmin
          .from('listings')
          .insert(insertPayload)
          .select('*')
          .single();

        if (insErr) {
          return NextResponse.json(
            { error: `Failed to create civic listing: ${insErr.message}` },
            { status: 500 }
          );
        }
        savedListing = inserted as Record<string, unknown>;
      }

      const targetListingId = String(savedListing.id);
      const officeHoursText =
        typeof (body.officeHoursText ?? body.office_hours_text) === 'string' &&
        String(body.officeHoursText ?? body.office_hours_text).trim()
          ? String(body.officeHoursText ?? body.office_hours_text)
              .trim()
              .slice(0, 300)
          : null;
      const importantNotes =
        typeof (body.importantNotes ?? body.important_notes) === 'string' &&
        String(body.importantNotes ?? body.important_notes).trim()
          ? String(body.importantNotes ?? body.important_notes)
              .trim()
              .slice(0, 1200)
          : null;
      const liveCivicAlert =
        typeof (body.liveCivicAlert ?? body.live_civic_alert) === 'string' &&
        String(body.liveCivicAlert ?? body.live_civic_alert).trim()
          ? String(body.liveCivicAlert ?? body.live_civic_alert)
              .trim()
              .slice(0, 500)
          : null;
      const rawExpiry =
        body.liveCivicAlertExpiresAt ?? body.live_civic_alert_expires_at;
      const liveCivicAlertExpiresAt =
        liveCivicAlert && typeof rawExpiry === 'string' && rawExpiry.trim()
          ? new Date(rawExpiry).toISOString()
          : null;
      const officialWebsite =
        typeof (body.officialWebsite ?? body.official_website) === 'string' &&
        String(body.officialWebsite ?? body.official_website).trim()
          ? String(body.officialWebsite ?? body.official_website)
              .trim()
              .slice(0, 300)
          : null;

      const { data: savedProfile, error: profErr } = await supabaseAdmin
        .from('listing_civic_profiles')
        .upsert(
          {
            listing_id: targetListingId,
            hub_id: hubId,
            department_type: departmentType,
            is_24x7: Boolean(body.is24x7 ?? body.is_24x7),
            office_hours_text: officeHoursText,
            helplines,
            document_checklists: documentChecklists,
            important_notes: importantNotes,
            live_civic_alert: liveCivicAlert,
            live_civic_alert_expires_at: liveCivicAlertExpiresAt,
            official_website: officialWebsite,
            show_nearby_print_helper:
              body.showNearbyPrintHelper !== undefined
                ? Boolean(body.showNearbyPrintHelper)
                : body.show_nearby_print_helper !== undefined
                  ? Boolean(body.show_nearby_print_helper)
                  : true,
            last_verified_at: nowIso,
            last_verified_by: actor.userId,
            updated_at: nowIso,
          },
          { onConflict: 'listing_id' }
        )
        .select('*')
        .single();

      if (profErr) {
        return NextResponse.json(
          { error: `Failed to save civic profile: ${profErr.message}` },
          { status: 500 }
        );
      }

      // Re-read refreshed listing (including trigger-updated vertical_summary)
      const { data: refreshedListing } = await supabaseAdmin
        .from('listings')
        .select('*')
        .eq('id', targetListingId)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        listing: refreshedListing || savedListing,
        civic_profile: savedProfile,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 2: update_live_alert
    // -------------------------------------------------------------------------
    if (action === 'update_live_alert') {
      const listingId = String(body.listingId || body.listing_id || '').trim();
      if (!UUID_REGEX.test(listingId)) {
        return NextResponse.json(
          { error: 'Valid listingId is required.' },
          { status: 400 }
        );
      }

      const { data: existingProfile, error: fetchErr } = await supabaseAdmin
        .from('listing_civic_profiles')
        .select('listing_id, hub_id')
        .eq('listing_id', listingId)
        .maybeSingle();

      if (fetchErr) {
        return NextResponse.json(
          { error: `Failed to load civic profile: ${fetchErr.message}` },
          { status: 500 }
        );
      }
      if (!existingProfile) {
        return NextResponse.json(
          { error: 'Civic profile not found for this listing.' },
          { status: 404 }
        );
      }

      const allowed = await canActorManageCivicHub(
        supabaseAdmin,
        actor,
        String(existingProfile.hub_id)
      );
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              'Forbidden: You do not have civic management privileges for this hub.',
          },
          { status: 403 }
        );
      }

      const rawAlert = body.liveCivicAlert ?? body.live_civic_alert;
      const liveCivicAlert =
        typeof rawAlert === 'string' && rawAlert.trim()
          ? rawAlert.trim().slice(0, 500)
          : null;

      const rawExpiry =
        body.liveCivicAlertExpiresAt ?? body.live_civic_alert_expires_at;
      let expiresAtIso: string | null = null;
      if (liveCivicAlert && typeof rawExpiry === 'string' && rawExpiry.trim()) {
        const parsed = new Date(rawExpiry);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: 'Invalid liveCivicAlertExpiresAt timestamp.' },
            { status: 400 }
          );
        }
        expiresAtIso = parsed.toISOString();
      }

      const { data: updatedProfile, error: updErr } = await supabaseAdmin
        .from('listing_civic_profiles')
        .update({
          live_civic_alert: liveCivicAlert,
          live_civic_alert_expires_at: expiresAtIso,
          last_verified_at: nowIso,
          last_verified_by: actor.userId,
          updated_at: nowIso,
        })
        .eq('listing_id', listingId)
        .select('*')
        .single();

      if (updErr) {
        return NextResponse.json(
          { error: `Failed to update live civic alert: ${updErr.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        civic_profile: updatedProfile,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION 3: review_correction
    // -------------------------------------------------------------------------
    if (action === 'review_correction') {
      const reportId = String(body.reportId || body.report_id || '').trim();
      const decision = String(body.decision || body.status || '')
        .trim()
        .toLowerCase();
      const reviewerNoteRaw = body.reviewerNote ?? body.reviewer_note;
      const reviewerNote =
        typeof reviewerNoteRaw === 'string' && reviewerNoteRaw.trim()
          ? reviewerNoteRaw.trim().slice(0, 500)
          : null;

      if (!UUID_REGEX.test(reportId)) {
        return NextResponse.json(
          { error: 'Valid reportId is required.' },
          { status: 400 }
        );
      }

      if (decision !== 'approved' && decision !== 'rejected') {
        return NextResponse.json(
          { error: 'decision must be "approved" or "rejected".' },
          { status: 400 }
        );
      }

      const { data: reportRow, error: reportErr } = await supabaseAdmin
        .from('civic_correction_reports')
        .select('id, hub_id, listing_id, status')
        .eq('id', reportId)
        .maybeSingle();

      if (reportErr) {
        return NextResponse.json(
          { error: `Failed to load correction report: ${reportErr.message}` },
          { status: 500 }
        );
      }
      if (!reportRow) {
        return NextResponse.json(
          { error: 'Correction report not found.' },
          { status: 404 }
        );
      }

      const allowed = await canActorManageCivicHub(
        supabaseAdmin,
        actor,
        String(reportRow.hub_id)
      );
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              'Forbidden: You do not have civic management privileges for this hub.',
          },
          { status: 403 }
        );
      }

      const { data: updatedReport, error: updErr } = await supabaseAdmin
        .from('civic_correction_reports')
        .update({
          status: decision,
          reviewed_by: actor.userId,
          reviewed_at: nowIso,
          reviewer_note: reviewerNote,
        })
        .eq('id', reportId)
        .select('*')
        .single();

      if (updErr) {
        return NextResponse.json(
          { error: `Failed to update correction report: ${updErr.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        report: updatedReport,
      });
    }

    return NextResponse.json(
      {
        error:
          'Unsupported action. Expected "upsert_civic_listing", "update_live_alert", or "review_correction".',
      },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while managing civic records.',
      },
      { status: 500 }
    );
  }
}
