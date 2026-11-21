export type AnnouncementVariant = 'info' | 'warning' | 'success' | 'urgent';

export interface AppIdentityConfig {
  app_name: string;
  short_name: string;
  tagline: string;
  logo_light_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  announcement_bar: {
    enabled: boolean;
    text: string;
    link_url: string;
    variant: AnnouncementVariant;
  };
}

export interface OfficeAndContactConfig {
  address: string;
  lat: number;
  lng: number;
  phone: string;
  whatsapp: string;
  email: string;
  operating_hours: string;
  whatsapp_enquiry_template: string;
}

export type PaymentGatewayMode = 'manual_only' | 'dual' | 'razorpay_only';
export type PaymentDefaultMethod = 'manual_upi' | 'razorpay';

export interface PaymentConfig {
  payment_mode: PaymentGatewayMode;
  razorpay_enabled: boolean;
  manual_upi_enabled: boolean;
  default_method: PaymentDefaultMethod;
  razorpay_key_id: string;
  upi_id: string;
  upi_payee_name: string;
  online_convenience_fee_pct: number;
  pick_n_drop_commission_pct: number;
  vehicle_booking_commission_pct: number;
  default_advance_pct: number;
  soft_hold_minutes: number;
  pod_purge_hours: number;
}

export interface ModuleSwitchItem {
  enabled: boolean;
  pause_message: string;
}

export interface OperationsConfig {
  hide_sample_data: boolean;
  geofence: {
    center_lat: number;
    center_lng: number;
    default_zoom: number;
    service_radius_km: number;
  };
  search_placeholders: string[];
  trending_suggestions: string[];
  prohibited_items: string[];
  module_switches: {
    explore: ModuleSwitchItem;
    marketplace: ModuleSwitchItem;
    bulletin: ModuleSwitchItem;
    pick_n_drop: ModuleSwitchItem;
    vehicle_bookings: ModuleSwitchItem;
    print_orders: ModuleSwitchItem;
    booking_venues: ModuleSwitchItem;
    hotel_stays: ModuleSwitchItem;
  };
  shop_orders?: boolean;
  food_orders?: boolean;
}

export interface PricingSurchargesConfig {
  fragile_crate_inr: number;
  bulk_sack_inr: number;
  extra_cylinder_inr: number;
  bulletin_single_post_inr: number;
  bulletin_single_post_days: number;
}

export interface LegalPagesConfig {
  terms_md: string;
  privacy_md: string;
  refund_policy_md: string;
  updated_at: string;
}

export type AppCategoryModule = 'explore' | 'marketplace' | 'bulletin';

export type CategoryEntityType = 'listing' | 'product' | 'bulletin' | 'vehicle';

export interface NestedCategoryNode {
  id: string;
  entity_type: CategoryEntityType;
  parent_id: string | null;
  depth: number;
  slug: string;
  display_name: string;
  icon: string;
  color_hex: string;
  sort_order: number;
  is_active: boolean;
  children: NestedCategoryNode[];
}

export type CategoriesByEntityMap = Record<
  CategoryEntityType,
  NestedCategoryNode[]
>;

export const EMPTY_CATEGORIES_BY_ENTITY: CategoriesByEntityMap = {
  listing: [],
  product: [],
  bulletin: [],
  vehicle: [],
};

export interface AppCategoryRecord {
  id?: string;
  slug: string;
  module: AppCategoryModule;
  display_name: string;
  icon: string;
  color_hex: string;
  sort_order: number;
  is_active: boolean;
  updated_at?: string;
}

export type HubLocalityStatus = 'verified' | 'pending' | 'merged';

export interface HubLocalityItem {
  id: string;
  hub_id: string;
  slug: string;
  display_name: string;
  aliases: string[];
  lat: number | null;
  lng: number | null;
  status: HubLocalityStatus;
  usage_count: number;
  sort_order?: number;
  is_active?: boolean;
}

export interface AppLocalityRecord {
  id?: string;
  hub_id?: string | null;
  slug: string;
  display_name: string;
  aliases?: string[];
  lat: number;
  lng: number;
  status?: string;
  sort_order: number;
  is_active: boolean;
  updated_at?: string;
}

export interface HelpbotFaqRecord {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  deep_link_url: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at?: string;
}

export interface PromoCodeRecord {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'flat' | 'percent';
  discount_value: number;
  max_discount_inr: number | null;
  min_order_inr: number;
  applies_to: string[];
  max_uses: number | null;
  used_count: number;
  starts_at: string;
  expires_at: string | null;
  is_active: boolean;
  target_hub_ids?: string[];
  is_global?: boolean;
  created_at: string;
}

export type AppAnnouncementType =
  | 'offer'
  | 'festive'
  | 'info'
  | 'announcement'
  | 'alert';

export interface AppAnnouncementRecord {
  id: string;
  type: AppAnnouncementType;
  badge_label: string | null;
  message: string;
  promo_code: string | null;
  cta_label: string | null;
  cta_url: string | null;
  starts_at: string | null;
  expires_at: string | null;
  priority: number;
  is_dismissible: boolean;
  is_active: boolean;
  target_hub_ids?: string[];
  is_global?: boolean;
  created_by?: string | null;
  created_at?: string;
}

export type AppBannerPlacement =
  | 'landing_top'
  | 'landing_mid'
  | 'explore_top'
  | 'marketplace_top'
  | 'bulletin_top';

export type AppBannerThemeStyle = 'clean' | 'primary' | 'festive' | 'dark';

export interface AppBannerRecord {
  id: string;
  title: string;
  subtitle: string | null;
  badge_text: string | null;
  image_url: string | null;
  cta_label: string | null;
  target_url: string;
  promo_code: string | null;
  placement: AppBannerPlacement;
  theme_style: AppBannerThemeStyle;
  sponsor_name: string | null;
  starts_at: string | null;
  expires_at: string | null;
  sort_order: number;
  impressions_count: number;
  clicks_count: number;
  is_active: boolean;
  target_hub_ids?: string[];
  is_global?: boolean;
  created_by?: string | null;
  created_at?: string;
}

export type ServiceHubStatus = 'active' | 'coming_soon' | 'paused';

export interface ServiceHubManualUpiOverride {
  upi_id?: string | null;
  upi_payee_name?: string | null;
}

export interface ServiceHubRecord {
  id: string;
  slug: string;
  name: string;
  state: string;
  center_lat: number;
  center_lng: number;
  service_radius_km: number;
  default_zoom: number;
  supported_languages: string[];
  default_language: string;
  office_contact: Partial<OfficeAndContactConfig>;
  manual_upi_override: ServiceHubManualUpiOverride | null;
  module_switches: Partial<
    Record<
      keyof OperationsConfig['module_switches'] | 'shop_orders' | 'food_orders',
      Partial<ModuleSwitchItem>
    >
  >;
  status: ServiceHubStatus;
  is_default: boolean;
  sort_order: number;
}

export interface HubVehicleRateItem {
  id: string;
  hub_id: string | null;
  vehicle_type_id: string;
  slug: string;
  name: string;
  icon: string | null;
  is_enabled_in_hub: boolean;
  base_fare_inr: number;
  per_km_rate_inr: number;
  wait_per_10min_inr: number;
  free_wait_minutes: number;
  two_way_multiplier: number;
  max_weight_kg: number;
  max_dimensions: string | null;
  supported_modes: string[];
  surcharges_override: Record<string, unknown>;
}

export interface AppConfig {
  hubs: ServiceHubRecord[];
  activeHub: ServiceHubRecord;
  hubVehicleRates: HubVehicleRateItem[];
  app_identity: AppIdentityConfig;
  office_and_contact: OfficeAndContactConfig;
  payment_config: PaymentConfig;
  operations_config: OperationsConfig;
  pricing_surcharges: PricingSurchargesConfig;
  legal_pages: LegalPagesConfig;
  categories: AppCategoryRecord[];
  categoriesFlat: NestedCategoryNode[];
  categoriesByEntity: CategoriesByEntityMap;
  localities: AppLocalityRecord[];
  hubLocalities: HubLocalityItem[];
  helpbot_faqs: HelpbotFaqRecord[];
  announcements: AppAnnouncementRecord[];
  banners: AppBannerRecord[];
  fetched_at: string;
}

export const DEFAULT_SERVICE_HUB: ServiceHubRecord = {
  id: 'default-churachandpur',
  slug: 'churachandpur',
  name: 'Churachandpur',
  state: 'Manipur',
  center_lat: 24.3333,
  center_lng: 93.6833,
  service_radius_km: 25,
  default_zoom: 14,
  supported_languages: ['en', 'paite', 'manipuri'],
  default_language: 'en',
  office_contact: {
    address: 'Central Lamka, Churachandpur, Manipur 795128',
    operating_hours: 'Mon–Sat, 8:00 AM – 8:00 PM',
  },
  manual_upi_override: null,
  module_switches: {},
  status: 'active',
  is_default: true,
  sort_order: 1,
};

export const DEFAULT_APP_IDENTITY: AppIdentityConfig = {
  app_name: 'DD oodle',
  short_name: 'DD oodle',
  tagline: 'Your Daily Discovery',
  logo_light_url: null,
  logo_dark_url: null,
  favicon_url: null,
  announcement_bar: {
    enabled: false,
    text: '',
    link_url: '',
    variant: 'info',
  },
};

export const DEFAULT_OFFICE_AND_CONTACT: OfficeAndContactConfig = {
  address: 'Central Lamka, Churachandpur, Manipur 795128',
  lat: 24.3333,
  lng: 93.6833,
  phone: '',
  whatsapp: '',
  email: '',
  operating_hours: 'Mon–Sat, 8:00 AM – 8:00 PM',
  whatsapp_enquiry_template: 'Hi, I found your listing on DD oodle: {{title}}',
};

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  payment_mode: 'manual_only',
  razorpay_enabled: false,
  manual_upi_enabled: true,
  default_method: 'manual_upi',
  razorpay_key_id: '',
  upi_id: '',
  upi_payee_name: 'DD oodle',
  online_convenience_fee_pct: 0,
  pick_n_drop_commission_pct: 12,
  vehicle_booking_commission_pct: 10,
  default_advance_pct: 25,
  soft_hold_minutes: 20,
  pod_purge_hours: 48,
};

export const DEFAULT_OPERATIONS_CONFIG: OperationsConfig = {
  hide_sample_data: false,
  geofence: {
    center_lat: 24.3333,
    center_lng: 93.6833,
    default_zoom: 14,
    service_radius_km: 25,
  },
  search_placeholders: [
    'Search shops, pharmacies, Tuibong...',
    'Find Bolero rentals or LPG pickup...',
  ],
  trending_suggestions: [
    'New Lamka',
    'Pharmacy',
    'Printing',
    'Real Estate',
    'Taxi',
  ],
  prohibited_items: [
    'Cash & Jewelry',
    'Illegal or Restricted Substances',
    'Flammable Fuels (excluding sealed LPG)',
    'Live Animals',
  ],
  module_switches: {
    explore: { enabled: true, pause_message: '' },
    marketplace: { enabled: true, pause_message: '' },
    bulletin: { enabled: true, pause_message: '' },
    pick_n_drop: { enabled: true, pause_message: '' },
    vehicle_bookings: { enabled: true, pause_message: '' },
    print_orders: { enabled: true, pause_message: '' },
    booking_venues: { enabled: true, pause_message: '' },
    hotel_stays: { enabled: true, pause_message: '' },
  },
  shop_orders: true,
  food_orders: true,
};

export const DEFAULT_PRICING_SURCHARGES: PricingSurchargesConfig = {
  fragile_crate_inr: 30,
  bulk_sack_inr: 50,
  extra_cylinder_inr: 20,
  bulletin_single_post_inr: 79,
  bulletin_single_post_days: 7,
};

export const DEFAULT_LEGAL_PAGES: LegalPagesConfig = {
  terms_md:
    '# Terms & Conditions\n\nWelcome to DD oodle — Your Daily Discovery.',
  privacy_md:
    '# Privacy Policy\n\nDD oodle protects user data and purges delivery proof automatically.',
  refund_policy_md:
    '# Refund & Cancellation Policy\n\nEligible cancellations and escrow disputes are refunded to the original payment source.',
  updated_at: '2026-11-20T00:00:00Z',
};

function asObj(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function asStr(val: unknown, fallback: string): string {
  return typeof val === 'string' ? val : fallback;
}

function asNullableStr(val: unknown, fallback: string | null): string | null {
  if (val === null) return null;
  if (typeof val === 'string') return val.trim() ? val : null;
  return fallback;
}

function asNum(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(val: unknown, fallback: boolean): boolean {
  return typeof val === 'boolean' ? val : fallback;
}

function asStringArray(val: unknown, fallback: string[]): string[] {
  if (!Array.isArray(val)) return [...fallback];
  return val
    .filter((v): v is string => typeof v === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeAppIdentity(raw: unknown): AppIdentityConfig {
  const obj = asObj(raw);
  const bar = asObj(obj.announcement_bar);
  const variantRaw = asStr(bar.variant, 'info');
  const variant: AnnouncementVariant =
    variantRaw === 'warning' ||
    variantRaw === 'success' ||
    variantRaw === 'urgent'
      ? variantRaw
      : 'info';

  return {
    app_name: asStr(obj.app_name, DEFAULT_APP_IDENTITY.app_name),
    short_name: asStr(obj.short_name, DEFAULT_APP_IDENTITY.short_name),
    tagline: asStr(obj.tagline, DEFAULT_APP_IDENTITY.tagline),
    logo_light_url: asNullableStr(obj.logo_light_url, null),
    logo_dark_url: asNullableStr(obj.logo_dark_url, null),
    favicon_url: asNullableStr(obj.favicon_url, null),
    announcement_bar: {
      enabled: asBool(bar.enabled, false),
      text: asStr(bar.text, ''),
      link_url: asStr(bar.link_url, ''),
      variant,
    },
  };
}

export function normalizeOfficeAndContact(
  raw: unknown
): OfficeAndContactConfig {
  const obj = asObj(raw);
  return {
    address: asStr(obj.address, DEFAULT_OFFICE_AND_CONTACT.address),
    lat: asNum(obj.lat, DEFAULT_OFFICE_AND_CONTACT.lat),
    lng: asNum(obj.lng, DEFAULT_OFFICE_AND_CONTACT.lng),
    phone: asStr(obj.phone, DEFAULT_OFFICE_AND_CONTACT.phone),
    whatsapp: asStr(obj.whatsapp, DEFAULT_OFFICE_AND_CONTACT.whatsapp),
    email: asStr(obj.email, DEFAULT_OFFICE_AND_CONTACT.email),
    operating_hours: asStr(
      obj.operating_hours,
      DEFAULT_OFFICE_AND_CONTACT.operating_hours
    ),
    whatsapp_enquiry_template: asStr(
      obj.whatsapp_enquiry_template,
      DEFAULT_OFFICE_AND_CONTACT.whatsapp_enquiry_template
    ),
  };
}

export function normalizePaymentConfig(raw: unknown): PaymentConfig {
  const obj = asObj(raw);
  const rawMode = asStr(obj.payment_mode, DEFAULT_PAYMENT_CONFIG.payment_mode);
  const payment_mode: PaymentGatewayMode =
    rawMode === 'dual' || rawMode === 'razorpay_only' ? rawMode : 'manual_only';

  const rawDefault = asStr(
    obj.default_method,
    DEFAULT_PAYMENT_CONFIG.default_method
  );
  const default_method: PaymentDefaultMethod =
    rawDefault === 'razorpay' ? 'razorpay' : 'manual_upi';

  // SECURITY: Whitelist only public/non-secret payment config fields
  return {
    payment_mode,
    razorpay_enabled: asBool(
      obj.razorpay_enabled,
      DEFAULT_PAYMENT_CONFIG.razorpay_enabled
    ),
    manual_upi_enabled: asBool(
      obj.manual_upi_enabled,
      DEFAULT_PAYMENT_CONFIG.manual_upi_enabled
    ),
    default_method,
    razorpay_key_id: asStr(
      obj.razorpay_key_id,
      DEFAULT_PAYMENT_CONFIG.razorpay_key_id
    ).trim(),
    upi_id: asStr(obj.upi_id, DEFAULT_PAYMENT_CONFIG.upi_id).trim(),
    upi_payee_name: asStr(
      obj.upi_payee_name,
      DEFAULT_PAYMENT_CONFIG.upi_payee_name
    ).trim(),
    online_convenience_fee_pct: Math.max(
      0,
      asNum(
        obj.online_convenience_fee_pct,
        DEFAULT_PAYMENT_CONFIG.online_convenience_fee_pct
      )
    ),
    pick_n_drop_commission_pct: Math.max(
      0,
      asNum(
        obj.pick_n_drop_commission_pct,
        DEFAULT_PAYMENT_CONFIG.pick_n_drop_commission_pct
      )
    ),
    vehicle_booking_commission_pct: Math.max(
      0,
      asNum(
        obj.vehicle_booking_commission_pct,
        DEFAULT_PAYMENT_CONFIG.vehicle_booking_commission_pct
      )
    ),
    default_advance_pct: Math.min(
      100,
      Math.max(
        0,
        asNum(obj.default_advance_pct, DEFAULT_PAYMENT_CONFIG.default_advance_pct)
      )
    ),
    soft_hold_minutes: Math.max(
      1,
      Math.round(
        asNum(obj.soft_hold_minutes, DEFAULT_PAYMENT_CONFIG.soft_hold_minutes)
      )
    ),
    pod_purge_hours: Math.max(
      1,
      Math.round(
        asNum(obj.pod_purge_hours, DEFAULT_PAYMENT_CONFIG.pod_purge_hours)
      )
    ),
  };
}

function normalizeSwitch(raw: unknown): ModuleSwitchItem {
  if (typeof raw === 'boolean') {
    return {
      enabled: raw,
      pause_message: '',
    };
  }
  const obj = asObj(raw);
  return {
    enabled: asBool(obj.enabled, true),
    pause_message: asStr(obj.pause_message, ''),
  };
}

export function normalizeOperationsConfig(
  raw: unknown,
  legacyHideSampleRaw?: unknown
): OperationsConfig {
  const obj = asObj(raw);
  const geo = asObj(obj.geofence);
  const switches = asObj(obj.module_switches);
  const legacyHideObj = asObj(legacyHideSampleRaw);

  const hideSampleData =
    typeof obj.hide_sample_data === 'boolean'
      ? obj.hide_sample_data
      : typeof legacyHideObj.enabled === 'boolean'
        ? legacyHideObj.enabled
        : DEFAULT_OPERATIONS_CONFIG.hide_sample_data;

  return {
    hide_sample_data: hideSampleData,
    geofence: {
      center_lat: asNum(
        geo.center_lat,
        DEFAULT_OPERATIONS_CONFIG.geofence.center_lat
      ),
      center_lng: asNum(
        geo.center_lng,
        DEFAULT_OPERATIONS_CONFIG.geofence.center_lng
      ),
      default_zoom: asNum(
        geo.default_zoom,
        DEFAULT_OPERATIONS_CONFIG.geofence.default_zoom
      ),
      service_radius_km: Math.max(
        1,
        asNum(
          geo.service_radius_km,
          DEFAULT_OPERATIONS_CONFIG.geofence.service_radius_km
        )
      ),
    },
    search_placeholders: asStringArray(
      obj.search_placeholders,
      DEFAULT_OPERATIONS_CONFIG.search_placeholders
    ),
    trending_suggestions: asStringArray(
      obj.trending_suggestions,
      DEFAULT_OPERATIONS_CONFIG.trending_suggestions
    ),
    prohibited_items: asStringArray(
      obj.prohibited_items,
      DEFAULT_OPERATIONS_CONFIG.prohibited_items
    ),
    module_switches: {
      explore: normalizeSwitch(switches.explore),
      marketplace: normalizeSwitch(switches.marketplace),
      bulletin: normalizeSwitch(switches.bulletin),
      pick_n_drop: normalizeSwitch(switches.pick_n_drop),
      vehicle_bookings: normalizeSwitch(switches.vehicle_bookings),
      print_orders: normalizeSwitch(switches.print_orders),
      booking_venues: normalizeSwitch(switches.booking_venues),
      hotel_stays: normalizeSwitch(switches.hotel_stays),
    },
    shop_orders: normalizeSwitch(switches.shop_orders ?? obj.shop_orders).enabled,
    food_orders: normalizeSwitch(switches.food_orders ?? obj.food_orders).enabled,
  };
}

export function normalizePricingSurcharges(
  raw: unknown,
  legacyBulletinPassRaw?: unknown
): PricingSurchargesConfig {
  const obj = asObj(raw);
  const legacyObj = asObj(legacyBulletinPassRaw);

  return {
    fragile_crate_inr: Math.max(
      0,
      asNum(obj.fragile_crate_inr, DEFAULT_PRICING_SURCHARGES.fragile_crate_inr)
    ),
    bulk_sack_inr: Math.max(
      0,
      asNum(obj.bulk_sack_inr, DEFAULT_PRICING_SURCHARGES.bulk_sack_inr)
    ),
    extra_cylinder_inr: Math.max(
      0,
      asNum(
        obj.extra_cylinder_inr,
        DEFAULT_PRICING_SURCHARGES.extra_cylinder_inr
      )
    ),
    bulletin_single_post_inr: Math.max(
      1,
      Math.round(
        asNum(
          obj.bulletin_single_post_inr ?? legacyObj.price_inr,
          DEFAULT_PRICING_SURCHARGES.bulletin_single_post_inr
        )
      )
    ),
    bulletin_single_post_days: Math.max(
      1,
      Math.round(
        asNum(
          obj.bulletin_single_post_days ?? legacyObj.duration_days,
          DEFAULT_PRICING_SURCHARGES.bulletin_single_post_days
        )
      )
    ),
  };
}

export function normalizeLegalPages(raw: unknown): LegalPagesConfig {
  const obj = asObj(raw);
  return {
    terms_md: asStr(obj.terms_md, DEFAULT_LEGAL_PAGES.terms_md),
    privacy_md: asStr(obj.privacy_md, DEFAULT_LEGAL_PAGES.privacy_md),
    refund_policy_md: asStr(
      obj.refund_policy_md,
      DEFAULT_LEGAL_PAGES.refund_policy_md
    ),
    updated_at: asStr(obj.updated_at, DEFAULT_LEGAL_PAGES.updated_at),
  };
}

/**
 * Builds pre-sorted nested 3-level category trees grouped by `entity_type`.
 */
export function buildNestedCategoryTrees(
  flatNodes: Array<Omit<NestedCategoryNode, 'children'> | NestedCategoryNode>
): CategoriesByEntityMap {
  const result: CategoriesByEntityMap = {
    listing: [],
    product: [],
    bulletin: [],
    vehicle: [],
  };

  const nodeMap = new Map<string, NestedCategoryNode>();
  for (const raw of flatNodes) {
    if (!raw || !raw.id) continue;
    nodeMap.set(raw.id, {
      id: raw.id,
      entity_type: raw.entity_type,
      parent_id: raw.parent_id ?? null,
      depth: Number(raw.depth ?? 0),
      slug: raw.slug,
      display_name: raw.display_name,
      icon: raw.icon || 'Tag',
      color_hex: raw.color_hex || '#2563EB',
      sort_order: Number(raw.sort_order ?? 0),
      is_active: Boolean(raw.is_active ?? true),
      children: [],
    });
  }

  for (const node of nodeMap.values()) {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      const parent = nodeMap.get(node.parent_id)!;
      if (parent.entity_type === node.entity_type) {
        parent.children.push(node);
        continue;
      }
    }
    if (result[node.entity_type]) {
      result[node.entity_type].push(node);
    }
  }

  const sortRecursive = (nodes: NestedCategoryNode[]) => {
    nodes.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.display_name.localeCompare(b.display_name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortRecursive(node.children);
      }
    }
  };

  sortRecursive(result.listing);
  sortRecursive(result.product);
  sortRecursive(result.bulletin);
  sortRecursive(result.vehicle);

  return result;
}

/**
 * Resolves a category's own ID & slug plus all active descendants' IDs & slugs
 * so filtering by any parent category automatically matches its nested children.
 */
export function collectCategorySubtree(
  flatNodes: NestedCategoryNode[],
  categoryIdOrSlug: string | null | undefined,
  entityType?: CategoryEntityType
): { ids: string[]; slugs: string[] } {
  const needle = (categoryIdOrSlug || '').trim();
  if (!needle || flatNodes.length === 0) {
    return { ids: [], slugs: [] };
  }

  const scoped = entityType
    ? flatNodes.filter((n) => n.entity_type === entityType && n.is_active)
    : flatNodes.filter((n) => n.is_active);

  const root =
    scoped.find((n) => n.id === needle) ||
    scoped.find((n) => n.slug.toLowerCase() === needle.toLowerCase());

  if (!root) {
    return { ids: [], slugs: [needle] };
  }

  const childrenByParent = new Map<string, NestedCategoryNode[]>();
  for (const node of scoped) {
    if (!node.parent_id) continue;
    const list = childrenByParent.get(node.parent_id) || [];
    list.push(node);
    childrenByParent.set(node.parent_id, list);
  }

  const ids: string[] = [];
  const slugs: string[] = [];
  const visited = new Set<string>();
  const queue: NestedCategoryNode[] = [root];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr.id)) continue;
    visited.add(curr.id);
    ids.push(curr.id);
    slugs.push(curr.slug);
    const kids = childrenByParent.get(curr.id);
    if (kids && kids.length > 0) {
      queue.push(...kids);
    }
  }

  return { ids, slugs };
}
