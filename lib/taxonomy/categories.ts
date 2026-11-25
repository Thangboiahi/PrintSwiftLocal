import { normalizeIconKey } from '@/lib/icons/registry';
import type { CategoryEntityType, NestedCategoryNode } from '@/lib/config/types';
import { LISTING_VERTICALS, type ListingVertical } from '@/lib/verticals/types';

export interface CanonicalSystemRootMeta {
  root_key: string;
  entity_type: CategoryEntityType;
  label: string;
  description: string;
  icon_key: string;
  accent_color: string;
  sort_order: number;
}

/**
 * The 8 locked Level-1 Directory Listing System Roots (matching `LISTING_VERTICALS`
 * and `payment_feature_policies` `listing_type` rows).
 */
export const CANONICAL_LISTING_SYSTEM_ROOTS: CanonicalSystemRootMeta[] = [
  {
    root_key: 'general',
    entity_type: 'listing',
    label: 'General Business & Services',
    description:
      'Local service professionals, repairs, clinics, coaching, salons, and general neighborhood businesses.',
    icon_key: 'briefcase',
    accent_color: '#2563EB',
    sort_order: 10,
  },
  {
    root_key: 'shop_catalogue',
    entity_type: 'listing',
    label: 'Retail & Local Shop Catalogue',
    description:
      'Local retail storefronts, pharmacies, electronics, groceries, hardware, and apparel shops.',
    icon_key: 'shopping-bag',
    accent_color: '#0D9488',
    sort_order: 20,
  },
  {
    root_key: 'restaurant_food',
    entity_type: 'listing',
    label: 'Restaurants, Cafés & Bakeries',
    description:
      'Dining spots, local kitchens, cafés, fast food counters, tea stalls, and bakeries.',
    icon_key: 'utensils',
    accent_color: '#EA580C',
    sort_order: 30,
  },
  {
    root_key: 'print_digital',
    entity_type: 'listing',
    label: 'Print, Copy & Digital Services',
    description:
      'Xerox, photo printing, flex banners, CSC documentation counters, and digital print studios.',
    icon_key: 'printer',
    accent_color: '#4F46E5',
    sort_order: 40,
  },
  {
    root_key: 'real_estate',
    entity_type: 'listing',
    label: 'Real Estate & Land Plots',
    description:
      'Patta land plots, residential houses, rental flats, shops, and commercial spaces with map boundaries.',
    icon_key: 'home',
    accent_color: '#D97706',
    sort_order: 50,
  },
  {
    root_key: 'hotel_stay',
    entity_type: 'listing',
    label: 'Hotels, Homestays & Lodging',
    description:
      'Verified hotels, guesthouses, homestays, lodges, and short-term stays.',
    icon_key: 'bed-double',
    accent_color: '#0284C7',
    sort_order: 60,
  },
  {
    root_key: 'booking_venue',
    entity_type: 'listing',
    label: 'Sports & Venue Bookings',
    description:
      'Futsal turfs, badminton courts, gyms, marriage halls, and hourly bookable event venues.',
    icon_key: 'trophy',
    accent_color: '#16A34A',
    sort_order: 70,
  },
  {
    root_key: 'public_civic',
    entity_type: 'listing',
    label: 'Public & Civic Institutions',
    description:
      'Government offices, emergency hospitals, police/fire stations, schools, churches, and public helplines.',
    icon_key: 'landmark',
    accent_color: '#7C3AED',
    sort_order: 80,
  },
];

/**
 * All 11 locked Level-1 System Roots across all 4 `entity_type` scopes.
 */
export const CANONICAL_ALL_SYSTEM_ROOTS: CanonicalSystemRootMeta[] = [
  ...CANONICAL_LISTING_SYSTEM_ROOTS,
  {
    root_key: 'marketplace',
    entity_type: 'product',
    label: 'Marketplace & Shop Products',
    description:
      'Product catalog taxonomy for local shops, handloom wear, electronics, stationery, and produce.',
    icon_key: 'store',
    accent_color: '#059669',
    sort_order: 10,
  },
  {
    root_key: 'bulletin',
    entity_type: 'bulletin',
    label: 'Community Bulletins & Notices',
    description:
      'District announcements, job postings, advertisements, public notices, and community events.',
    icon_key: 'megaphone',
    accent_color: '#E11D48',
    sort_order: 10,
  },
  {
    root_key: 'vehicles',
    entity_type: 'vehicle',
    label: 'Fleet & Vehicle Rentals',
    description:
      'City taxis, 4WD hill charters, inter-hub Winger/Sumo counters, and goods pickup vehicles.',
    icon_key: 'car',
    accent_color: '#0891B2',
    sort_order: 10,
  },
];

export const CANONICAL_LISTING_ROOT_KEY_SET = new Set<string>(LISTING_VERTICALS);

export const CANONICAL_SYSTEM_ROOT_META_BY_KEY: Record<
  string,
  CanonicalSystemRootMeta
> = Object.fromEntries(
  CANONICAL_ALL_SYSTEM_ROOTS.map((r) => [r.root_key, r])
);

/**
 * Normalizes category depth into 1..3 regardless of whether a row comes from
 * legacy 0-indexed (`0..2`) or v16b 1-indexed (`1..3`) snapshots.
 */
export function normalizeCategoryDepth(
  rawDepth: unknown,
  parentId?: string | null,
  parentDepth?: number | null
): 1 | 2 | 3 {
  if (parentId === null) return 1;
  if (parentId === undefined) {
    const num = Number(rawDepth);
    if (Number.isFinite(num)) {
      if (num >= 3) return 3;
      if (num === 2) return 2;
      return 1;
    }
    return 1;
  }
  if (typeof parentDepth === 'number' && parentDepth >= 1) {
    return parentDepth >= 2 ? 3 : 2;
  }
  const parsed = Number(rawDepth);
  if (Number.isFinite(parsed)) {
    if (parsed >= 3) return 3;
    if (parsed === 2) return 2;
    if (parsed === 1) return 2; // Legacy 0-indexed child
  }
  return 2;
}

/**
 * Maps any legacy listing vertical/category slug to one of the 8 locked listing `root_key`s.
 */
export function resolveListingRootKey(
  rawRootOrVertical?: string | null,
  legacyCategory?: string | null,
  isCivic?: boolean | null
): ListingVertical {
  if (isCivic) return 'public_civic';
  const clean = (rawRootOrVertical || '').trim().toLowerCase().replace(/-/g, '_');
  if (CANONICAL_LISTING_ROOT_KEY_SET.has(clean)) {
    return clean as ListingVertical;
  }
  const legacy = (legacyCategory || '').trim().toLowerCase().replace(/-/g, '_');
  if (legacy === 'real_estate' || legacy === 'real_estate_rentals') {
    return 'real_estate';
  }
  if (
    legacy === 'public_place' ||
    legacy === 'public_community' ||
    legacy === 'public_civic'
  ) {
    return 'public_civic';
  }
  if (legacy === 'sports' || legacy === 'sports_recreation') {
    return 'booking_venue';
  }
  if (legacy === 'business' || legacy === 'businesses_shops') {
    return 'shop_catalogue';
  }
  return 'general';
}

function toCategoryNodeMap(
  source: Map<string, NestedCategoryNode> | NestedCategoryNode[]
): Map<string, NestedCategoryNode> {
  if (source instanceof Map) return source;
  return new Map(source.map((n) => [n.id, n]));
}

/**
 * Resolves the effective Lucide icon key for any L1/L2/L3 category node,
 * inheriting parent -> root icon if an L2/L3 `icon_key` is unset or generic `'tag'`.
 */
export function resolveEffectiveCategoryIconKey(
  node: Pick<
    NestedCategoryNode,
    'id' | 'parent_id' | 'root_key' | 'icon_key' | 'icon' | 'depth'
  >,
  nodeByIdOrFlat: Map<string, NestedCategoryNode> | NestedCategoryNode[]
): string {
  const own = (node.icon_key || node.icon || '').trim().toLowerCase();
  if (own && own !== 'tag') {
    return normalizeIconKey(own);
  }
  const nodeById = toCategoryNodeMap(nodeByIdOrFlat);
  // Walk upward to parent -> root
  let cursorParentId = node.parent_id;
  let guard = 0;
  while (cursorParentId && guard < 4) {
    guard += 1;
    const parent = nodeById.get(cursorParentId);
    if (!parent) break;
    const pIcon = (parent.icon_key || parent.icon || '').trim().toLowerCase();
    if (pIcon && pIcon !== 'tag') {
      return normalizeIconKey(pIcon);
    }
    cursorParentId = parent.parent_id;
  }
  const rootMeta = node.root_key
    ? CANONICAL_SYSTEM_ROOT_META_BY_KEY[node.root_key]
    : null;
  return normalizeIconKey(rootMeta?.icon_key || own || 'tag');
}

/**
 * Resolves effective accent hex color, inheriting parent -> root accent if unset.
 */
export function resolveEffectiveCategoryAccentColor(
  node: Pick<
    NestedCategoryNode,
    'id' | 'parent_id' | 'root_key' | 'accent_color' | 'color_hex'
  >,
  nodeByIdOrFlat: Map<string, NestedCategoryNode> | NestedCategoryNode[]
): string {
  const own = (node.accent_color || node.color_hex || '').trim();
  if (own) return own;
  const nodeById = toCategoryNodeMap(nodeByIdOrFlat);
  let cursorParentId = node.parent_id;
  let guard = 0;
  while (cursorParentId && guard < 4) {
    guard += 1;
    const parent = nodeById.get(cursorParentId);
    if (!parent) break;
    const pColor = (parent.accent_color || parent.color_hex || '').trim();
    if (pColor) return pColor;
    cursorParentId = parent.parent_id;
  }
  const rootMeta = node.root_key
    ? CANONICAL_SYSTEM_ROOT_META_BY_KEY[node.root_key]
    : null;
  return rootMeta?.accent_color || '#2563EB';
}

/**
 * Returns the full `[L1, L2, L3]` breadcrumb path for a category node ID or slug.
 */
export function getCategoryBreadcrumbPath(
  flatNodes: NestedCategoryNode[],
  categoryIdOrSlug: string | null | undefined,
  entityType?: CategoryEntityType
): NestedCategoryNode[] {
  const needle = (categoryIdOrSlug || '').trim();
  if (!needle || flatNodes.length === 0) return [];
  const scoped = entityType
    ? flatNodes.filter((n) => n.entity_type === entityType)
    : flatNodes;

  const byId = new Map(scoped.map((n) => [n.id, n]));
  const target =
    byId.get(needle) ||
    scoped.find((n) => n.slug.toLowerCase() === needle.toLowerCase());
  if (!target) return [];

  if (Array.isArray(target.path_ids) && target.path_ids.length > 0) {
    const resolved = target.path_ids
      .map((id) => byId.get(id))
      .filter((n): n is NestedCategoryNode => Boolean(n));
    if (resolved.length > 0) return resolved;
  }

  const trail: NestedCategoryNode[] = [];
  let cursor: NestedCategoryNode | undefined = target;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    trail.unshift(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return trail;
}

/**
 * Uses materialized `path_ids` (with parent-pointer fallback) to collect a category's
 * own ID/slug AND all descendant L2/L3 IDs/slugs for Explore hierarchical filtering.
 */
export function collectHierarchicalCategoryDescendantFilter(
  flatNodes: NestedCategoryNode[],
  categoryIdOrSlugOrRootKey: string | null | undefined,
  entityType: CategoryEntityType = 'listing'
): { ids: string[]; slugs: string[]; rootKey: string | null } {
  const needle = (categoryIdOrSlugOrRootKey || '').trim();
  if (!needle || flatNodes.length === 0) {
    return { ids: [], slugs: [], rootKey: null };
  }

  const scoped = flatNodes.filter((n) => n.entity_type === entityType);
  const needleLower = needle.toLowerCase();

  const target =
    scoped.find((n) => n.id === needle) ||
    scoped.find(
      (n) => n.is_system_root && n.root_key?.toLowerCase() === needleLower
    ) ||
    scoped.find((n) => n.slug.toLowerCase() === needleLower);

  if (!target) {
    return { ids: [], slugs: [needle], rootKey: null };
  }

  const ids = new Set<string>([target.id]);
  const slugs = new Set<string>([target.slug]);

  // Fast path: use materialized `path_ids`
  let usedPathIds = false;
  for (const node of scoped) {
    if (Array.isArray(node.path_ids) && node.path_ids.length > 0) {
      usedPathIds = true;
      if (node.path_ids.includes(target.id)) {
        ids.add(node.id);
        slugs.add(node.slug);
      }
    }
  }

  // Fallback for rows loaded prior to v16b migration
  if (!usedPathIds || ids.size === 1) {
    const kidsByParent = new Map<string, NestedCategoryNode[]>();
    for (const node of scoped) {
      if (!node.parent_id) continue;
      const list = kidsByParent.get(node.parent_id) || [];
      list.push(node);
      kidsByParent.set(node.parent_id, list);
    }
    const queue: NestedCategoryNode[] = [target];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      ids.add(curr.id);
      slugs.add(curr.slug);
      const kids = kidsByParent.get(curr.id);
      if (kids) {
        for (const k of kids) {
          if (!ids.has(k.id)) queue.push(k);
        }
      }
    }
  }

  return {
    ids: Array.from(ids),
    slugs: Array.from(slugs),
    rootKey: target.root_key || null,
  };
}

export const collectHierarchicalCategoryDescendantFilters =
  collectHierarchicalCategoryDescendantFilter;

/**
 * Mirrors SQL `public.category_matches_plan_scope` on the client:
 * - Selecting an L1 root covers all its L2 & L3 descendants.
 * - Selecting an L2 category covers all its L3 leaves.
 */
export function categoryNodeMatchesEntitlementScope(
  node: Pick<NestedCategoryNode, 'id' | 'root_key' | 'path_ids' | 'slug'>,
  scope: {
    isSuperAdminBypass?: boolean;
    allowedRootKeys?: string[];
    allowedCategoryIds?: string[];
    allowedListingTypes?: string[];
  }
): boolean {
  if (scope.isSuperAdminBypass) return true;

  const rootKeys = scope.allowedRootKeys || [];
  const catIds = scope.allowedCategoryIds || [];
  const listingTypes = scope.allowedListingTypes || [];

  if (rootKeys.includes('*')) return true;

  const nodeRoot = (node.root_key || '').trim().toLowerCase();
  if (nodeRoot) {
    if (rootKeys.includes(nodeRoot)) return true;
    // Also honor allowed_listing_types when no granular category IDs restrict that root
    if (catIds.length === 0 && listingTypes.includes(nodeRoot)) return true;
  }

  if (catIds.length > 0) {
    const path =
      Array.isArray(node.path_ids) && node.path_ids.length > 0
        ? node.path_ids
        : [node.id];
    if (path.some((id) => catIds.includes(id))) {
      return true;
    }
  }

  return false;
}
