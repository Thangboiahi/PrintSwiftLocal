import { NextRequest, NextResponse } from 'next/server';
import { fetchPublicAppConfig } from '@/lib/config/server';
import { createServerSupabaseReadClient } from '@/lib/pick-n-drop/fare';

/**
 * GET /api/config/public?hub=<slug>&hubId=<uuid>&fresh=1
 * Resolves the active service hub, merges hub overrides over global platform_settings,
 * joins hub_vehicle_rates with vehicle_types, and returns hub-targeted banners/announcements.
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const freshParam = searchParams.get('fresh');
    const bypassCache = freshParam === '1' || freshParam === 'true';
    const hubSlug = searchParams.get('hub')?.trim() || null;
    const hubId =
      searchParams.get('hubId')?.trim() ||
      searchParams.get('hub_id')?.trim() ||
      null;

    const supabase = createServerSupabaseReadClient();
    const config = await fetchPublicAppConfig(supabase, {
      hubSlug,
      hubId,
    });

    return NextResponse.json(
      {
        // Canonical Phase 66-B multi-hub response keys
        hubs: config.hubs,
        activeHub: config.activeHub,
        identity: config.app_identity,
        office: config.office_and_contact,
        paymentConfig: config.payment_config,
        operations: config.operations_config,
        surcharges: config.pricing_surcharges,
        legal: config.legal_pages,
        hubVehicleRates: config.hubVehicleRates,
        categories: config.categories,
        categoriesFlat: config.categoriesFlat,
        categoriesByEntity: config.categoriesByEntity,
        localities: config.localities,
        hubLocalities: config.hubLocalities,
        helpbotFaqs: config.helpbot_faqs,
        announcements: config.announcements,
        banners: config.banners,
        // Backward-compatible snake_case keys for existing consumers
        app_identity: config.app_identity,
        office_and_contact: config.office_and_contact,
        payment_config: config.payment_config,
        operations_config: config.operations_config,
        pricing_surcharges: config.pricing_surcharges,
        legal_pages: config.legal_pages,
        helpbot_faqs: config.helpbot_faqs,
        fetched_at: config.fetched_at,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': bypassCache
            ? 'no-store, max-age=0'
            : 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to load public platform configuration.',
      },
      { status: 500 }
    );
  }
}
