import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildNestedCategoryTrees,
  DEFAULT_APP_IDENTITY,
  DEFAULT_LEGAL_PAGES,
  DEFAULT_OFFICE_AND_CONTACT,
  DEFAULT_OPERATIONS_CONFIG,
  DEFAULT_PAYMENT_CONFIG,
  DEFAULT_PRICING_SURCHARGES,
  DEFAULT_SERVICE_HUB,
  EMPTY_CATEGORIES_BY_ENTITY,
  normalizeAppIdentity,
  normalizeLegalPages,
  normalizeOfficeAndContact,
  normalizeOperationsConfig,
  normalizePaymentConfig,
  normalizePricingSurcharges,
  type AppAnnouncementRecord,
  type AppAnnouncementType,
  type AppBannerPlacement,
  type AppBannerRecord,
  type AppBannerThemeStyle,
  type AppCategoryModule,
  type AppCategoryRecord,
  type AppConfig,
  type AppLocalityRecord,
  type CategoryEntityType,
  type HelpbotFaqRecord,
  type HubLocalityItem,
  type HubLocalityStatus,
  type HubVehicleRateItem,
  type ModuleSwitchItem,
  type NestedCategoryNode,
  type OfficeAndContactConfig,
  type OperationsConfig,
  type PaymentConfig,
  type PricingSurchargesConfig,
  type ServiceHubManualUpiOverride,
  type ServiceHubRecord,
  type ServiceHubStatus,
} from '@/lib/config/types';

const PLATFORM_CONFIG_KEYS = [
  'app_identity',
  'office_and_contact',
  'payment_config',
  'operations_config',
  'pricing_surcharges',
  'legal_pages',
  'hide_sample_data',
  'bulletin_pay_per_post',
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidStr(val?: string | null): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

function asPlainObj(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

export function normalizeServiceHubRow(
  row: Record<string, unknown>
): ServiceHubRecord {
  const rawStatus = String(row.status || 'active').toLowerCase();
  const status: ServiceHubStatus =
    rawStatus === 'coming_soon' || rawStatus === 'paused'
      ? rawStatus
      : 'active';

  const rawManualUpi = asPlainObj(row.manual_upi_override);
  const manualUpiOverride: ServiceHubManualUpiOverride | null =
    typeof rawManualUpi.upi_id === 'string' && rawManualUpi.upi_id.trim()
      ? {
          upi_id: rawManualUpi.upi_id.trim(),
          upi_payee_name:
            typeof rawManualUpi.upi_payee_name === 'string' &&
            rawManualUpi.upi_payee_name.trim()
              ? rawManualUpi.upi_payee_name.trim()
              : null,
        }
      : null;

  const rawOffice = asPlainObj(row.office_contact);
  const officeContact: Partial<OfficeAndContactConfig> = {};
  if (typeof rawOffice.address === 'string' && rawOffice.address.trim()) {
    officeContact.address = rawOffice.address.trim();
  }
  if (
    rawOffice.lat !== undefined &&
    rawOffice.lat !== null &&
    Number.isFinite(Number(rawOffice.lat))
  ) {
    officeContact.lat = Number(rawOffice.lat);
  }
  if (
    rawOffice.lng !== undefined &&
    rawOffice.lng !== null &&
    Number.isFinite(Number(rawOffice.lng))
  ) {
    officeContact.lng = Number(rawOffice.lng);
  }
  if (typeof rawOffice.phone === 'string' && rawOffice.phone.trim()) {
    officeContact.phone = rawOffice.phone.trim();
  }
  if (typeof rawOffice.whatsapp === 'string' && rawOffice.whatsapp.trim()) {
    officeContact.whatsapp = rawOffice.whatsapp.trim();
  }
  if (typeof rawOffice.email === 'string' && rawOffice.email.trim()) {
    officeContact.email = rawOffice.email.trim();
  }
  if (
    typeof rawOffice.operating_hours === 'string' &&
    rawOffice.operating_hours.trim()
  ) {
    officeContact.operating_hours = rawOffice.operating_hours.trim();
  }
  if (
    typeof rawOffice.whatsapp_enquiry_template === 'string' &&
    rawOffice.whatsapp_enquiry_template.trim()
  ) {
    officeContact.whatsapp_enquiry_template =
      rawOffice.whatsapp_enquiry_template.trim();
  }

  const rawSwitches = asPlainObj(row.module_switches);
  const moduleSwitches: ServiceHubRecord['module_switches'] = {};
  const moduleKeys = [
    'explore',
    'marketplace',
    'bulletin',
    'pick_n_drop',
    'vehicle_bookings',
    'print_orders',
    'booking_venues',
    'hotel_stays',
    'shop_orders',
    'food_orders',
  ] as const;
  for (const key of moduleKeys) {
    const rawVal = rawSwitches[key];
    if (typeof rawVal === 'boolean') {
      moduleSwitches[key] = {
        enabled: rawVal,
        pause_message: '',
      };
      continue;
    }
    const sw = asPlainObj(rawVal);
    if (typeof sw.enabled === 'boolean' || typeof sw.pause_message === 'string') {
      moduleSwitches[key] = {
        enabled: typeof sw.enabled === 'boolean' ? sw.enabled : true,
        pause_message:
          typeof sw.pause_message === 'string' ? sw.pause_message : '',
      };
    }
  }

  return {
    id: String(row.id || DEFAULT_SERVICE_HUB.id),
    slug: String(row.slug || DEFAULT_SERVICE_HUB.slug),
    name: String(row.name || DEFAULT_SERVICE_HUB.name),
    state: String(row.state || DEFAULT_SERVICE_HUB.state),
    center_lat: Number.isFinite(Number(row.center_lat))
      ? Number(row.center_lat)
      : DEFAULT_SERVICE_HUB.center_lat,
    center_lng: Number.isFinite(Number(row.center_lng))
      ? Number(row.center_lng)
      : DEFAULT_SERVICE_HUB.center_lng,
    service_radius_km:
      Number.isFinite(Number(row.service_radius_km)) &&
      Number(row.service_radius_km) > 0
        ? Number(row.service_radius_km)
        : DEFAULT_SERVICE_HUB.service_radius_km,
    default_zoom: Number.isFinite(Number(row.default_zoom))
      ? Math.round(Number(row.default_zoom))
      : DEFAULT_SERVICE_HUB.default_zoom,
    supported_languages: Array.isArray(row.supported_languages)
      ? row.supported_languages
          .map((l) => String(l).trim())
          .filter(Boolean)
      : ['en'],
    default_language: String(row.default_language || 'en'),
    office_contact: officeContact,
    manual_upi_override: manualUpiOverride,
    module_switches: moduleSwitches,
    status,
    is_default: Boolean(row.is_default),
    sort_order: Number.isFinite(Number(row.sort_order))
      ? Number(row.sort_order)
      : 0,
  };
}

export async function fetchVisibleServiceHubs(
  supabase: SupabaseClient | null
): Promise<ServiceHubRecord[]> {
  if (!supabase) return [DEFAULT_SERVICE_HUB];
  try {
    const { data, error } = await supabase
      .from('service_hubs')
      .select(
        'id, slug, name, state, center_lat, center_lng, service_radius_km, default_zoom, supported_languages, default_language, office_contact, manual_upi_override, module_switches, status, is_default, sort_order'
      )
      .in('status', ['active', 'coming_soon'])
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row) =>
        normalizeServiceHubRow(row as Record<string, unknown>)
      );
    }
  } catch {
    // Fall back to default Churachandpur hub when service_hubs table isn't migrated yet
  }
  return [DEFAULT_SERVICE_HUB];
}

export async function resolveServerServiceHub(
  supabase: SupabaseClient | null,
  options?: { hubSlug?: string | null; hubId?: string | null }
): Promise<{
  hubs: ServiceHubRecord[];
  activeHub: ServiceHubRecord;
}> {
  const hubs = await fetchVisibleServiceHubs(supabase);
  const activeHubs = hubs.filter((h) => h.status === 'active');

  const requestedSlug = (options?.hubSlug || '').trim().toLowerCase();
  const requestedId = (options?.hubId || '').trim();

  let matched: ServiceHubRecord | undefined;
  if (requestedId && isUuidStr(requestedId)) {
    matched = activeHubs.find((h) => h.id === requestedId);
  }
  if (!matched && requestedSlug) {
    matched = activeHubs.find((h) => h.slug.toLowerCase() === requestedSlug);
  }

  const defaultActive =
    matched ||
    activeHubs.find((h) => h.is_default) ||
    activeHubs[0] ||
    hubs.find((h) => h.is_default) ||
    hubs[0] ||
    DEFAULT_SERVICE_HUB;

  return {
    hubs,
    activeHub: defaultActive,
  };
}

/**
 * Resolves a single active hub by UUID or slug (falling back to the default hub).
 */
export async function resolveServiceHubByIdOrDefault(
  supabase: SupabaseClient | null,
  hubIdOrSlug?: string | null
): Promise<ServiceHubRecord> {
  const clean = (hubIdOrSlug || '').trim();
  const { activeHub } = await resolveServerServiceHub(supabase, {
    hubId: isUuidStr(clean) ? clean : null,
    hubSlug: clean && !isUuidStr(clean) ? clean : null,
  });
  return activeHub;
}

function mergeOfficeWithHub(
  globalOffice: OfficeAndContactConfig,
  hub: ServiceHubRecord
): OfficeAndContactConfig {
  const o = hub.office_contact || {};
  return {
    address: o.address?.trim() ? o.address.trim() : globalOffice.address,
    lat:
      typeof o.lat === 'number' && Number.isFinite(o.lat)
        ? o.lat
        : hub.center_lat ?? globalOffice.lat,
    lng:
      typeof o.lng === 'number' && Number.isFinite(o.lng)
        ? o.lng
        : hub.center_lng ?? globalOffice.lng,
    phone: o.phone?.trim() ? o.phone.trim() : globalOffice.phone,
    whatsapp: o.whatsapp?.trim() ? o.whatsapp.trim() : globalOffice.whatsapp,
    email: o.email?.trim() ? o.email.trim() : globalOffice.email,
    operating_hours: o.operating_hours?.trim()
      ? o.operating_hours.trim()
      : globalOffice.operating_hours,
    whatsapp_enquiry_template: o.whatsapp_enquiry_template?.trim()
      ? o.whatsapp_enquiry_template.trim()
      : globalOffice.whatsapp_enquiry_template,
  };
}

function mergeSingleModuleSwitch(
  globalSwitch: ModuleSwitchItem,
  hubSwitch?: Partial<ModuleSwitchItem>
): ModuleSwitchItem {
  const hubDisabled = hubSwitch?.enabled === false;
  const globalDisabled = globalSwitch.enabled === false;
  const enabled = !globalDisabled && !hubDisabled;
  const pause_message = globalDisabled
    ? globalSwitch.pause_message || hubSwitch?.pause_message || ''
    : hubDisabled
      ? hubSwitch?.pause_message || globalSwitch.pause_message || ''
      : '';
  return { enabled, pause_message };
}

function mergeOperationsWithHub(
  globalOps: OperationsConfig,
  hub: ServiceHubRecord
): OperationsConfig {
  const hs = hub.module_switches || {};
  return {
    ...globalOps,
    geofence: {
      center_lat: hub.center_lat,
      center_lng: hub.center_lng,
      default_zoom: hub.default_zoom,
      service_radius_km: hub.service_radius_km,
    },
    module_switches: {
      explore: mergeSingleModuleSwitch(
        globalOps.module_switches.explore,
        hs.explore
      ),
      marketplace: mergeSingleModuleSwitch(
        globalOps.module_switches.marketplace,
        hs.marketplace
      ),
      bulletin: mergeSingleModuleSwitch(
        globalOps.module_switches.bulletin,
        hs.bulletin
      ),
      pick_n_drop: mergeSingleModuleSwitch(
        globalOps.module_switches.pick_n_drop,
        hs.pick_n_drop
      ),
      vehicle_bookings: mergeSingleModuleSwitch(
        globalOps.module_switches.vehicle_bookings,
        hs.vehicle_bookings
      ),
      print_orders: mergeSingleModuleSwitch(
        globalOps.module_switches.print_orders,
        hs.print_orders
      ),
      booking_venues: mergeSingleModuleSwitch(
        globalOps.module_switches.booking_venues,
        hs.booking_venues
      ),
      hotel_stays: mergeSingleModuleSwitch(
        globalOps.module_switches.hotel_stays,
        hs.hotel_stays
      ),
      shop_orders: mergeSingleModuleSwitch(
        globalOps.module_switches.shop_orders,
        hs.shop_orders
      ),
      food_orders: mergeSingleModuleSwitch(
        globalOps.module_switches.food_orders,
        hs.food_orders
      ),
    },
    shop_orders:
      hs.shop_orders?.enabled !== undefined
        ? Boolean(hs.shop_orders.enabled)
        : globalOps.shop_orders ?? true,
    food_orders:
      hs.food_orders?.enabled !== undefined
        ? Boolean(hs.food_orders.enabled)
        : globalOps.food_orders ?? true,
  };
}

export function mergePaymentConfigWithHub(
  globalPayment: PaymentConfig,
  hub?: ServiceHubRecord | null
): PaymentConfig {
  const overrideUpi = hub?.manual_upi_override?.upi_id?.trim();
  if (!overrideUpi) {
    return globalPayment;
  }
  const overridePayee = hub?.manual_upi_override?.upi_payee_name?.trim();
  return {
    ...globalPayment,
    upi_id: overrideUpi,
    upi_payee_name: overridePayee || globalPayment.upi_payee_name,
  };
}

export async function fetchMasterPlatformSettingsMap(
  supabase: SupabaseClient | null,
  keys: readonly string[] = PLATFORM_CONFIG_KEYS
): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();
  if (!supabase) return map;

  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', [...keys]);

    if (!error && Array.isArray(data)) {
      for (const row of data as Array<{ key?: string; value?: unknown }>) {
        if (row.key) {
          map.set(row.key, row.value);
        }
      }
    }
  } catch {
    // Gracefully fall back to defaults
  }

  return map;
}

export async function fetchServerPaymentConfig(
  supabase: SupabaseClient | null,
  hubId?: string | null
): Promise<PaymentConfig> {
  const [map, hub] = await Promise.all([
    fetchMasterPlatformSettingsMap(supabase, ['payment_config']),
    hubId ? resolveServiceHubByIdOrDefault(supabase, hubId) : Promise.resolve(null),
  ]);
  const base = normalizePaymentConfig(map.get('payment_config'));
  return mergePaymentConfigWithHub(base, hub);
}

export async function fetchServerQuoteConfig(
  supabase: SupabaseClient | null
): Promise<{
  pricing_surcharges: PricingSurchargesConfig;
  operations_config: OperationsConfig;
}> {
  const map = await fetchMasterPlatformSettingsMap(supabase, [
    'pricing_surcharges',
    'operations_config',
    'hide_sample_data',
    'bulletin_pay_per_post',
  ]);

  return {
    pricing_surcharges: normalizePricingSurcharges(
      map.get('pricing_surcharges'),
      map.get('bulletin_pay_per_post')
    ),
    operations_config: normalizeOperationsConfig(
      map.get('operations_config'),
      map.get('hide_sample_data')
    ),
  };
}

export async function fetchPublicAppConfig(
  supabase: SupabaseClient | null,
  options?: { hubSlug?: string | null; hubId?: string | null }
): Promise<AppConfig> {
  const fetchedAt = new Date().toISOString();

  if (!supabase) {
    return {
      hubs: [DEFAULT_SERVICE_HUB],
      activeHub: DEFAULT_SERVICE_HUB,
      hubVehicleRates: [],
      app_identity: { ...DEFAULT_APP_IDENTITY },
      office_and_contact: { ...DEFAULT_OFFICE_AND_CONTACT },
      payment_config: { ...DEFAULT_PAYMENT_CONFIG },
      operations_config: { ...DEFAULT_OPERATIONS_CONFIG },
      pricing_surcharges: { ...DEFAULT_PRICING_SURCHARGES },
      legal_pages: { ...DEFAULT_LEGAL_PAGES },
      categories: [],
      categoriesFlat: [],
      categoriesByEntity: { ...EMPTY_CATEGORIES_BY_ENTITY },
      localities: [],
      hubLocalities: [],
      helpbot_faqs: [],
      announcements: [],
      banners: [],
      fetched_at: fetchedAt,
    };
  }

  const { hubs, activeHub } = await resolveServerServiceHub(supabase, options);
  const hasRealHubId = isUuidStr(activeHub.id);

  const nowMs = Date.now();
  const isWithinSchedule = (
    startsAt?: string | null,
    expiresAt?: string | null
  ): boolean => {
    if (startsAt) {
      const startMs = Date.parse(startsAt);
      if (!Number.isNaN(startMs) && startMs > nowMs) return false;
    }
    if (expiresAt) {
      const endMs = Date.parse(expiresAt);
      if (!Number.isNaN(endMs) && endMs <= nowMs) return false;
    }
    return true;
  };

  const matchesHubTargeting = (
    isGlobalRaw: unknown,
    targetHubIdsRaw: unknown
  ): boolean => {
    // Legacy rows without multi-hub columns default to global visibility
    if (isGlobalRaw === undefined || isGlobalRaw === null) return true;
    if (Boolean(isGlobalRaw)) return true;
    if (!hasRealHubId) return false;
    if (Array.isArray(targetHubIdsRaw)) {
      return targetHubIdsRaw.some((id) => String(id) === activeHub.id);
    }
    return false;
  };

  const [
    settingsRes,
    vehicleTypesRes,
    hubRatesRes,
    nestedCategoriesRes,
    legacyCategoriesRes,
    hubLocalitiesRes,
    legacyLocalitiesRes,
    faqsRes,
    announcementsRes,
    bannersRes,
  ] = await Promise.all([
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', [...PLATFORM_CONFIG_KEYS]),
    supabase
      .from('vehicle_types')
      .select(
        'id, slug, name, icon, base_fare_inr, per_km_rate_inr, wait_per_10min_inr, free_wait_minutes, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, is_active'
      )
      .eq('is_active', true)
      .order('base_fare_inr', { ascending: true }),
    hasRealHubId
      ? supabase
          .from('hub_vehicle_rates')
          .select(
            'id, hub_id, vehicle_type_id, is_enabled_in_hub, base_fare_inr, per_km_rate_inr, wait_per_10min_inr, free_wait_minutes, two_way_multiplier, surcharges_override'
          )
          .eq('hub_id', activeHub.id)
      : Promise.resolve({ data: null, error: null }),
    Promise.resolve(
      supabase
        .from('categories')
        .select(
          'id, entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active'
        )
        .eq('is_active', true)
        .order('depth', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('display_name', { ascending: true })
    ).catch(() => ({ data: null, error: { message: 'categories_unavailable' } })),
    supabase
      .from('app_categories')
      .select(
        'slug, module, display_name, icon, color_hex, sort_order, is_active, updated_at'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('display_name', { ascending: true }),
    hasRealHubId
      ? Promise.resolve(
          supabase
            .from('hub_localities')
            .select(
              'id, hub_id, slug, display_name, aliases, lat, lng, status, usage_count'
            )
            .eq('hub_id', activeHub.id)
            .eq('status', 'verified')
            .order('usage_count', { ascending: false })
            .order('display_name', { ascending: true })
        ).catch(() => ({
          data: null,
          error: { message: 'hub_localities_unavailable' },
        }))
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('app_localities')
      .select(
        'slug, display_name, lat, lng, sort_order, is_active, updated_at'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('display_name', { ascending: true }),
    supabase
      .from('helpbot_faqs')
      .select(
        'id, category, question, answer, keywords, deep_link_url, sort_order, is_active, updated_at'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('app_announcements')
      .select(
        'id, type, badge_label, message, promo_code, cta_label, cta_url, starts_at, expires_at, priority, is_dismissible, is_active, target_hub_ids, is_global, created_at'
      )
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('app_banners')
      .select(
        'id, title, subtitle, badge_text, image_url, cta_label, target_url, promo_code, placement, theme_style, sponsor_name, starts_at, expires_at, sort_order, impressions_count, clicks_count, is_active, target_hub_ids, is_global, created_at'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  const settingsMap = new Map<string, unknown>();
  if (!settingsRes.error && Array.isArray(settingsRes.data)) {
    for (const row of settingsRes.data as Array<{
      key?: string;
      value?: unknown;
    }>) {
      if (row.key) settingsMap.set(row.key, row.value);
    }
  }

  // Merge hub_vehicle_rates with global vehicle_types (filtering is_enabled_in_hub = true)
  const hubRateByVehicleTypeId = new Map<string, Record<string, unknown>>();
  if (!hubRatesRes.error && Array.isArray(hubRatesRes.data)) {
    for (const row of hubRatesRes.data as Array<Record<string, unknown>>) {
      if (row.vehicle_type_id) {
        hubRateByVehicleTypeId.set(String(row.vehicle_type_id), row);
      }
    }
  }

  const hubVehicleRates: HubVehicleRateItem[] = [];
  if (!vehicleTypesRes.error && Array.isArray(vehicleTypesRes.data)) {
    for (const vt of vehicleTypesRes.data as Array<Record<string, unknown>>) {
      const vtId = String(vt.id);
      const override = hubRateByVehicleTypeId.get(vtId);
      if (override && override.is_enabled_in_hub === false) {
        continue;
      }

      hubVehicleRates.push({
        id: override?.id ? String(override.id) : vtId,
        hub_id: hasRealHubId ? activeHub.id : null,
        vehicle_type_id: vtId,
        slug: String(vt.slug || ''),
        name: String(vt.name || ''),
        icon: vt.icon ? String(vt.icon) : null,
        is_enabled_in_hub: true,
        base_fare_inr: Number(override?.base_fare_inr ?? vt.base_fare_inr ?? 0),
        per_km_rate_inr: Number(
          override?.per_km_rate_inr ?? vt.per_km_rate_inr ?? 0
        ),
        wait_per_10min_inr: Number(
          override?.wait_per_10min_inr ?? vt.wait_per_10min_inr ?? 20
        ),
        free_wait_minutes: Number(
          override?.free_wait_minutes ?? vt.free_wait_minutes ?? 15
        ),
        two_way_multiplier: Number(
          override?.two_way_multiplier ?? vt.two_way_multiplier ?? 1.75
        ),
        max_weight_kg: Number(vt.max_weight_kg ?? 0),
        max_dimensions: vt.max_dimensions ? String(vt.max_dimensions) : null,
        supported_modes: Array.isArray(vt.supported_modes)
          ? vt.supported_modes.map((m) => String(m))
          : ['parcel', 'passenger', 'gas'],
        surcharges_override: asPlainObj(override?.surcharges_override),
      });
    }
  }

  const legacyCategories: AppCategoryRecord[] =
    !legacyCategoriesRes.error && Array.isArray(legacyCategoriesRes.data)
      ? legacyCategoriesRes.data.map((row) => ({
          slug: String(row.slug),
          module: (row.module === 'marketplace' || row.module === 'bulletin'
            ? row.module
            : 'explore') as AppCategoryModule,
          display_name: String(row.display_name || row.slug),
          icon: String(row.icon || 'Tag'),
          color_hex: String(row.color_hex || '#2563EB'),
          sort_order: Number(row.sort_order ?? 0),
          is_active: Boolean(row.is_active ?? true),
          updated_at: row.updated_at ? String(row.updated_at) : undefined,
        }))
      : [];

  const VALID_ENTITY_TYPES = new Set<CategoryEntityType>([
    'listing',
    'product',
    'bulletin',
    'vehicle',
  ]);

  let categoriesFlat: NestedCategoryNode[] = [];
  if (
    !nestedCategoriesRes.error &&
    Array.isArray(nestedCategoriesRes.data) &&
    nestedCategoriesRes.data.length > 0
  ) {
    categoriesFlat = (
      nestedCategoriesRes.data as Array<Record<string, unknown>>
    )
      .filter((row) =>
        VALID_ENTITY_TYPES.has(String(row.entity_type) as CategoryEntityType)
      )
      .map((row) => ({
        id: String(row.id),
        entity_type: String(row.entity_type) as CategoryEntityType,
        parent_id: row.parent_id ? String(row.parent_id) : null,
        depth: Number(row.depth ?? 0),
        slug: String(row.slug),
        display_name: String(row.display_name || row.slug),
        icon: String(row.icon || 'Tag'),
        color_hex: String(row.color_hex || '#2563EB'),
        sort_order: Number(row.sort_order ?? 0),
        is_active: Boolean(row.is_active ?? true),
        children: [],
      }));
  } else if (legacyCategories.length > 0) {
    categoriesFlat = legacyCategories.map((c) => ({
      id: `legacy_${c.module}_${c.slug}`,
      entity_type:
        c.module === 'marketplace'
          ? 'product'
          : c.module === 'bulletin'
            ? 'bulletin'
            : 'listing',
      parent_id: null,
      depth: 0,
      slug: c.slug,
      display_name: c.display_name,
      icon: c.icon,
      color_hex: c.color_hex,
      sort_order: c.sort_order,
      is_active: c.is_active,
      children: [],
    }));
  }

  const categoriesByEntity = buildNestedCategoryTrees(categoriesFlat);

  // Preserve legacy flat `categories` list for existing filters, deriving from nested roots if app_categories is empty
  const categories: AppCategoryRecord[] =
    legacyCategories.length > 0
      ? legacyCategories
      : categoriesFlat
          .filter((c) => c.depth === 0 && c.entity_type !== 'vehicle')
          .map((c) => ({
            slug: c.slug,
            module:
              c.entity_type === 'product'
                ? 'marketplace'
                : c.entity_type === 'bulletin'
                  ? 'bulletin'
                  : 'explore',
            display_name: c.display_name,
            icon: c.icon,
            color_hex: c.color_hex,
            sort_order: c.sort_order,
            is_active: c.is_active,
          }));

  const legacyLocalities: AppLocalityRecord[] =
    !legacyLocalitiesRes.error && Array.isArray(legacyLocalitiesRes.data)
      ? legacyLocalitiesRes.data.map((row) => ({
          slug: String(row.slug),
          display_name: String(row.display_name || row.slug),
          lat: Number(row.lat),
          lng: Number(row.lng),
          sort_order: Number(row.sort_order ?? 0),
          is_active: Boolean(row.is_active ?? true),
          updated_at: row.updated_at ? String(row.updated_at) : undefined,
        }))
      : [];

  let hubLocalities: HubLocalityItem[] = [];
  if (
    !hubLocalitiesRes.error &&
    Array.isArray(hubLocalitiesRes.data) &&
    hubLocalitiesRes.data.length > 0
  ) {
    hubLocalities = (
      hubLocalitiesRes.data as Array<Record<string, unknown>>
    ).map((row) => {
      const rawStatus = String(row.status || 'verified').toLowerCase();
      const status: HubLocalityStatus =
        rawStatus === 'pending' || rawStatus === 'merged'
          ? rawStatus
          : 'verified';
      return {
        id: String(row.id),
        hub_id: String(row.hub_id || activeHub.id),
        slug: String(row.slug),
        display_name: String(row.display_name || row.slug),
        aliases: Array.isArray(row.aliases)
          ? row.aliases.map((a) => String(a).trim()).filter(Boolean)
          : [],
        lat:
          row.lat !== null &&
          row.lat !== undefined &&
          Number.isFinite(Number(row.lat))
            ? Number(row.lat)
            : null,
        lng:
          row.lng !== null &&
          row.lng !== undefined &&
          Number.isFinite(Number(row.lng))
            ? Number(row.lng)
            : null,
        status,
        usage_count: Number(row.usage_count ?? 0),
      };
    });
  } else if (legacyLocalities.length > 0) {
    hubLocalities = legacyLocalities.map((loc) => ({
      id: `legacy_${activeHub.slug}_${loc.slug}`,
      hub_id: activeHub.id,
      slug: loc.slug,
      display_name: loc.display_name,
      aliases: [],
      lat: Number.isFinite(loc.lat) ? loc.lat : null,
      lng: Number.isFinite(loc.lng) ? loc.lng : null,
      status: 'verified',
      usage_count: 0,
    }));
  }

  // Keep `localities` mapped cleanly from active hub's verified pool so zero existing UI breaks
  const localities: AppLocalityRecord[] =
    hubLocalities.length > 0
      ? hubLocalities.map((hl, idx) => ({
          slug: hl.slug,
          display_name: hl.display_name,
          lat: hl.lat ?? activeHub.center_lat,
          lng: hl.lng ?? activeHub.center_lng,
          sort_order: idx * 10,
          is_active: true,
        }))
      : legacyLocalities;

  const helpbot_faqs: HelpbotFaqRecord[] =
    !faqsRes.error && Array.isArray(faqsRes.data)
      ? faqsRes.data.map((row) => ({
          id: String(row.id),
          category: String(row.category || 'General'),
          question: String(row.question || ''),
          answer: String(row.answer || ''),
          keywords: Array.isArray(row.keywords)
            ? row.keywords.map((k: unknown) => String(k))
            : [],
          deep_link_url: row.deep_link_url ? String(row.deep_link_url) : null,
          sort_order: Number(row.sort_order ?? 0),
          is_active: Boolean(row.is_active ?? true),
          updated_at: row.updated_at ? String(row.updated_at) : undefined,
        }))
      : [];

  const VALID_ANN_TYPES = new Set<AppAnnouncementType>([
    'offer',
    'festive',
    'info',
    'announcement',
    'alert',
  ]);
  const announcements: AppAnnouncementRecord[] =
    !announcementsRes.error && Array.isArray(announcementsRes.data)
      ? announcementsRes.data
          .filter(
            (row) =>
              Boolean(row.is_active) &&
              isWithinSchedule(
                row.starts_at ? String(row.starts_at) : null,
                row.expires_at ? String(row.expires_at) : null
              ) &&
              matchesHubTargeting(row.is_global, row.target_hub_ids)
          )
          .map((row) => {
            const rawType = String(row.type || 'info') as AppAnnouncementType;
            return {
              id: String(row.id),
              type: VALID_ANN_TYPES.has(rawType) ? rawType : 'info',
              badge_label: row.badge_label ? String(row.badge_label) : null,
              message: String(row.message || ''),
              promo_code: row.promo_code ? String(row.promo_code) : null,
              cta_label: row.cta_label ? String(row.cta_label) : null,
              cta_url: row.cta_url ? String(row.cta_url) : null,
              starts_at: row.starts_at ? String(row.starts_at) : null,
              expires_at: row.expires_at ? String(row.expires_at) : null,
              priority: Number(row.priority ?? 0),
              is_dismissible: Boolean(row.is_dismissible ?? true),
              is_active: Boolean(row.is_active ?? true),
              target_hub_ids: Array.isArray(row.target_hub_ids)
                ? row.target_hub_ids.map((id: unknown) => String(id))
                : [],
              is_global: Boolean(row.is_global ?? true),
              created_at: row.created_at ? String(row.created_at) : undefined,
            };
          })
      : [];

  const VALID_PLACEMENTS = new Set<AppBannerPlacement>([
    'landing_top',
    'landing_mid',
    'explore_top',
    'marketplace_top',
    'bulletin_top',
  ]);
  const VALID_THEMES = new Set<AppBannerThemeStyle>([
    'clean',
    'primary',
    'festive',
    'dark',
  ]);
  const banners: AppBannerRecord[] =
    !bannersRes.error && Array.isArray(bannersRes.data)
      ? bannersRes.data
          .filter(
            (row) =>
              Boolean(row.is_active) &&
              VALID_PLACEMENTS.has(String(row.placement) as AppBannerPlacement) &&
              isWithinSchedule(
                row.starts_at ? String(row.starts_at) : null,
                row.expires_at ? String(row.expires_at) : null
              ) &&
              matchesHubTargeting(row.is_global, row.target_hub_ids)
          )
          .map((row) => {
            const rawTheme = String(
              row.theme_style || 'clean'
            ) as AppBannerThemeStyle;
            return {
              id: String(row.id),
              title: String(row.title || ''),
              subtitle: row.subtitle ? String(row.subtitle) : null,
              badge_text: row.badge_text ? String(row.badge_text) : null,
              image_url: row.image_url ? String(row.image_url) : null,
              cta_label: row.cta_label ? String(row.cta_label) : 'Learn More',
              target_url: String(row.target_url || '/explore'),
              promo_code: row.promo_code ? String(row.promo_code) : null,
              placement: String(row.placement) as AppBannerPlacement,
              theme_style: VALID_THEMES.has(rawTheme) ? rawTheme : 'clean',
              sponsor_name: row.sponsor_name ? String(row.sponsor_name) : null,
              starts_at: row.starts_at ? String(row.starts_at) : null,
              expires_at: row.expires_at ? String(row.expires_at) : null,
              sort_order: Number(row.sort_order ?? 0),
              impressions_count: Number(row.impressions_count ?? 0),
              clicks_count: Number(row.clicks_count ?? 0),
              is_active: Boolean(row.is_active ?? true),
              target_hub_ids: Array.isArray(row.target_hub_ids)
                ? row.target_hub_ids.map((id: unknown) => String(id))
                : [],
              is_global: Boolean(row.is_global ?? true),
              created_at: row.created_at ? String(row.created_at) : undefined,
            };
          })
      : [];

  const globalIdentity = normalizeAppIdentity(settingsMap.get('app_identity'));
  const globalOffice = normalizeOfficeAndContact(
    settingsMap.get('office_and_contact')
  );
  const globalPayment = normalizePaymentConfig(
    settingsMap.get('payment_config')
  );
  const globalOperations = normalizeOperationsConfig(
    settingsMap.get('operations_config'),
    settingsMap.get('hide_sample_data')
  );

  const mergedOffice = mergeOfficeWithHub(globalOffice, activeHub);
  const mergedOperations = mergeOperationsWithHub(globalOperations, activeHub);
  const mergedPayment = mergePaymentConfigWithHub(globalPayment, activeHub);

  return {
    hubs,
    activeHub,
    hubVehicleRates,
    app_identity: globalIdentity,
    office_and_contact: mergedOffice,
    payment_config: mergedPayment,
    operations_config: mergedOperations,
    pricing_surcharges: normalizePricingSurcharges(
      settingsMap.get('pricing_surcharges'),
      settingsMap.get('bulletin_pay_per_post')
    ),
    legal_pages: normalizeLegalPages(settingsMap.get('legal_pages')),
    categories,
    categoriesFlat,
    categoriesByEntity,
    localities,
    hubLocalities,
    helpbot_faqs,
    announcements,
    banners,
    fetched_at: fetchedAt,
  };
}
