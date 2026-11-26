'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgePercent,
  CalendarClock,
  CreditCard,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Tag,
  Truck,
  UserCheck,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { useHub } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import {
  normalizePricingSurcharges,
  type PricingSurchargesConfig,
  type PromoCodeRecord,
} from '@/lib/config/types';
import type { DeliveryServiceMode } from '@/lib/pick-n-drop/types';
import { supabase } from '@/lib/supabase/client';
import {
  SUBSCRIPTION_FEATURE_CATALOG,
  SUBSCRIPTION_LIMIT_CATALOG,
} from '@/lib/subscriptions/feature-catalog';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';
import { ComposablePlanBuilderSection } from './ComposablePlanBuilderSection';

interface PricingSubsPromosTabProps extends MasterControlTabSharedProps {
  initialSurcharges: PricingSurchargesConfig;
}

interface VehicleTypeRow {
  id: string;
  slug: string;
  name: string;
  base_fare_inr: number;
  per_km_rate_inr: number;
  wait_per_10min_inr: number;
  free_wait_minutes: number;
  two_way_multiplier: number;
  max_weight_kg: number;
  supported_modes: DeliveryServiceMode[];
  is_active: boolean;
  sort_order: number;
}

type PlanScope =
  | 'bulletin'
  | 'print_pro'
  | 'merchant_bundle'
  | 'booking_pro'
  | 'stay_pro'
  | 'catalogue_pro'
  | 'restaurant_pro'
  | 'real_estate_boost'
  | 'agent_pro'
  | 'merchant_all_in_one';

interface PlanEntitlements {
  print_ordering: boolean;
  custom_digital_quotes: boolean;
  escrow_enabled: boolean;
  booking_venues: boolean;
  hotel_stays: boolean;
  shop_catalogue: boolean;
  restaurant_food: boolean;
  real_estate_pro: boolean;
  max_monthly_orders: number | null;
}

interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  duration_days: number;
  max_active_bulletins: number;
  max_monthly_posts: number;
  max_images_per_post: number;
  allow_youtube: boolean;
  is_active: boolean;
  plan_scope: PlanScope;
  entitlements: PlanEntitlements;
}

interface MatchedUserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  name: string | null;
  phone: string | null;
  role: string | null;
}

interface UserSubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  status: string;
  starts_at: string | null;
  expires_at: string | null;
  payment_ref: string | null;
  created_at: string;
}

const SERVICE_MODES: Array<{ id: DeliveryServiceMode; label: string }> = [
  { id: 'parcel', label: 'Parcel' },
  { id: 'passenger', label: 'Ride' },
  { id: 'gas', label: 'LPG Gas' },
];

const SUB_STATUS_OPTIONS: CustomSelectOption[] = [
  { value: 'active', label: 'Active', description: 'Live & able to publish' },
  {
    value: 'pending_payment',
    label: 'Pending Payment',
    description: 'Awaiting UPI/Gateway verification',
  },
  { value: 'expired', label: 'Expired', description: 'Past validity period' },
  {
    value: 'cancelled',
    label: 'Cancelled',
    description: 'Revoked by user or admin',
  },
];

const DISCOUNT_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'flat', label: 'Flat ₹ Off', description: 'Fixed rupee discount' },
  {
    value: 'percent',
    label: 'Percentage % Off',
    description: 'Percentage off up to max cap',
  },
];

const PLAN_SCOPE_OPTIONS: CustomSelectOption[] = [
  {
    value: 'bulletin',
    label: 'Bulletin',
    description: 'Community Bulletin publishing & media quotas',
  },
  {
    value: 'print_pro',
    label: 'Print & Digital Pro',
    description: 'Online print counter, PDF/photo orders & escrow',
  },
  {
    value: 'booking_pro',
    label: 'Booking Venue Pro',
    description: 'Turfs, event halls & hourly/daily slot booking engine',
  },
  {
    value: 'stay_pro',
    label: 'Hotel & Homestay Pro',
    description: 'Multi-unit nightly room inventory & check-in OTPs',
  },
  {
    value: 'catalogue_pro',
    label: 'Shop Catalogue Pro',
    description: '0% commission local storefront, stock toggles & Pick N Drop delivery',
  },
  {
    value: 'restaurant_pro',
    label: 'Restaurant & Kitchen Pro',
    description: '0% commission digital menus, takeaway, hot-food delivery & tables',
  },
  {
    value: 'real_estate_boost',
    label: 'Real Estate Boost (30d)',
    description: 'Pay-per-listing 30-day Featured Map Pin & verified priority boost',
  },
  {
    value: 'agent_pro',
    label: 'Real Estate Agent Pro',
    description: 'Monthly plan for local real estate agents (up to 15 active properties)',
  },
  {
    value: 'merchant_bundle',
    label: 'Merchant Bundle',
    description: 'Combined Bulletin + Print & Digital Pro entitlements',
  },
  {
    value: 'merchant_all_in_one',
    label: 'Merchant All-In-One',
    description: 'Full access across Bulletins, Print, Venues, Stays, Shops & Food',
  },
];

const PROMO_MODULES: Array<{ id: string; label: string }> = [
  { id: 'pick_n_drop', label: 'Pick N Drop' },
  { id: 'vehicle_booking', label: 'Vehicle Booking' },
  { id: 'bulletin_subscription', label: 'Bulletin Plan' },
  { id: 'bulletin_post_pass', label: 'Single Post Pass' },
  { id: 'print_order', label: 'Print Order' },
  { id: 'print_pro_subscription', label: 'Print Pro Plan' },
  { id: 'resource_booking', label: 'Venue & Stay Booking' },
  { id: 'booking_pro_subscription', label: 'Booking Pro Plan' },
  { id: 'stay_pro_subscription', label: 'Stay Pro Plan' },
  { id: 'shop_order', label: 'Shop Order' },
  { id: 'restaurant_order', label: 'Food Order' },
  { id: 'catalogue_pro_subscription', label: 'Catalogue Pro Plan' },
  { id: 'restaurant_pro_subscription', label: 'Restaurant Pro Plan' },
  { id: 'real_estate_boost_30d', label: 'Property Boost (30d)' },
  { id: 'agent_pro_subscription', label: 'Agent Pro Plan' },
];

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalToIso(localValue: string): string | null {
  if (!localValue.trim()) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function PricingSubsPromosTab({
  initialSurcharges,
  onSavePlatformSetting,
  onNotify,
  refreshGlobalConfig,
}: PricingSubsPromosTabProps) {
  const { hubs } = useHub();
  const { confirm: confirmFinancialSave, dialog: confirmFinancialDialog } =
    useConfirmDialogState();
  const [surcharges, setSurcharges] = useState<PricingSurchargesConfig>(() =>
    normalizePricingSurcharges(initialSurcharges)
  );
  const [savingSurcharges, setSavingSurcharges] = useState(false);

  const [vehicles, setVehicles] = useState<VehicleTypeRow[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlanRow[]>([]);
  const [planSearch, setPlanSearch] = useState('');
  const [planScopeFilter, setPlanScopeFilter] = useState<'all' | PlanScope>(
    'all'
  );
  const [promos, setPromos] = useState<PromoCodeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  // User subscription date/time override state
  const [userQuery, setUserQuery] = useState('');
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [matchedUsers, setMatchedUsers] = useState<MatchedUserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<MatchedUserProfile | null>(
    null
  );
  const [userSubs, setUserSubs] = useState<UserSubscriptionRow[]>([]);
  const [loadingUserSubs, setLoadingUserSubs] = useState(false);
  const [overrideSubId, setOverrideSubId] = useState<string | null>(null);
  const [overridePlanId, setOverridePlanId] = useState('');
  const [overrideStatus, setOverrideStatus] = useState('active');
  const [overrideStartsAt, setOverrideStartsAt] = useState(() =>
    toDatetimeLocalValue(new Date().toISOString())
  );
  const [overrideExpiresAt, setOverrideExpiresAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toDatetimeLocalValue(d.toISOString());
  });
  const [savingOverride, setSavingOverride] = useState(false);
  // Pass V4: Tri-state per-feature Super-Admin overrides ('inherit' | 'enable' | 'disable') + custom numeric quota overrides
  const [overrideFeatureStates, setOverrideFeatureStates] = useState<
    Record<string, 'inherit' | 'enable' | 'disable'>
  >({});
  const [overrideLimitValues, setOverrideLimitValues] = useState<
    Record<string, string>
  >({});
  const [showCustomOverridesPanel, setShowCustomOverridesPanel] =
    useState(false);

  // New Promo Code form state
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoDesc, setNewPromoDesc] = useState('');
  const [newPromoType, setNewPromoType] = useState<'flat' | 'percent'>('flat');
  const [newPromoValue, setNewPromoValue] = useState('25');
  const [newPromoMaxDisc, setNewPromoMaxDisc] = useState('');
  const [newPromoMinOrder, setNewPromoMinOrder] = useState('0');
  const [newPromoApplies, setNewPromoApplies] = useState<string[]>([
    'pick_n_drop',
    'vehicle_booking',
  ]);
  const [newPromoMaxUses, setNewPromoMaxUses] = useState('');
  const [newPromoExpiresAt, setNewPromoExpiresAt] = useState('');
  const [newPromoIsGlobal, setNewPromoIsGlobal] = useState(true);
  const [newPromoHubIds, setNewPromoHubIds] = useState<string[]>([]);
  const [creatingPromo, setCreatingPromo] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setSurcharges(normalizePricingSurcharges(initialSurcharges));
    });
  }, [initialSurcharges]);

  const loadAllTables = useCallback(async () => {
    setIsLoading(true);
    try {
      const [vehRes, planRes, promoRes] = await Promise.all([
        supabase
          .from('vehicle_types')
          .select('*')
          .order('sort_order', { ascending: true }),
        supabase
          .rpc('superadmin_list_subscription_plans')
          .order('price_inr', { ascending: true }),
        supabase
          .from('promo_codes')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);

      if (!vehRes.error && Array.isArray(vehRes.data)) {
        setVehicles(
          vehRes.data.map((row) => ({
            id: String(row.id),
            slug: String(row.slug ?? ''),
            name: String(row.name ?? ''),
            base_fare_inr: Number(row.base_fare_inr ?? 0),
            per_km_rate_inr: Number(row.per_km_rate_inr ?? 0),
            wait_per_10min_inr: Number(row.wait_per_10min_inr ?? 0),
            free_wait_minutes: Number(row.free_wait_minutes ?? 10),
            two_way_multiplier: Number(row.two_way_multiplier ?? 1.75),
            max_weight_kg: Number(row.max_weight_kg ?? 20),
            supported_modes: Array.isArray(row.supported_modes)
              ? (row.supported_modes as DeliveryServiceMode[])
              : ['parcel'],
            is_active: Boolean(row.is_active),
            sort_order: Number(row.sort_order ?? 10),
          }))
        );
      }

      if (!planRes.error && Array.isArray(planRes.data)) {
        const mappedPlans: SubscriptionPlanRow[] = planRes.data.map((row) => {
          const rawScope = String(row.plan_scope ?? 'bulletin');
          const plan_scope: PlanScope =
            rawScope === 'print_pro' ||
            rawScope === 'merchant_bundle' ||
            rawScope === 'booking_pro' ||
            rawScope === 'stay_pro' ||
            rawScope === 'catalogue_pro' ||
            rawScope === 'restaurant_pro' ||
            rawScope === 'real_estate_boost' ||
            rawScope === 'agent_pro' ||
            rawScope === 'merchant_all_in_one'
              ? rawScope
              : 'bulletin';
          const rawEnt =
            row.entitlements &&
            typeof row.entitlements === 'object' &&
            !Array.isArray(row.entitlements)
              ? (row.entitlements as Record<string, unknown>)
              : {};
          const maxOrdersRaw = rawEnt.max_monthly_orders;
          const maxOrdersParsed =
            maxOrdersRaw === null ||
            maxOrdersRaw === undefined ||
            maxOrdersRaw === ''
              ? null
              : Number.isFinite(Number(maxOrdersRaw)) &&
                  Number(maxOrdersRaw) > 0
                ? Math.round(Number(maxOrdersRaw))
                : null;
          return {
            id: String(row.id),
            slug: String(row.slug ?? ''),
            name: String(row.name ?? ''),
            price_inr: Number(row.price_inr ?? 0),
            duration_days: Number(row.duration_days ?? 30),
            max_active_bulletins: Number(row.max_active_bulletins ?? 1),
            max_monthly_posts: Number(row.max_monthly_posts ?? 10),
            max_images_per_post: Number(row.max_images_per_post ?? 3),
            allow_youtube: Boolean(row.allow_youtube),
            is_active: Boolean(row.is_active),
            plan_scope,
            entitlements: {
              print_ordering: Boolean(
                rawEnt.print_ordering ??
                  (plan_scope === 'print_pro' ||
                    plan_scope === 'merchant_bundle')
              ),
              custom_digital_quotes: Boolean(
                rawEnt.custom_digital_quotes ??
                  (plan_scope === 'print_pro' ||
                    plan_scope === 'merchant_bundle')
              ),
              escrow_enabled: Boolean(
                rawEnt.escrow_enabled ??
                  (plan_scope === 'print_pro' ||
                    plan_scope === 'merchant_bundle' ||
                    plan_scope === 'booking_pro' ||
                    plan_scope === 'stay_pro' ||
                    plan_scope === 'catalogue_pro' ||
                    plan_scope === 'restaurant_pro' ||
                    plan_scope === 'merchant_all_in_one')
              ),
              booking_venues: Boolean(
                rawEnt.booking_venues ??
                  (plan_scope === 'booking_pro' ||
                    plan_scope === 'merchant_all_in_one')
              ),
              hotel_stays: Boolean(
                rawEnt.hotel_stays ??
                  (plan_scope === 'stay_pro' ||
                    plan_scope === 'merchant_all_in_one')
              ),
              shop_catalogue: Boolean(
                rawEnt.shop_catalogue ??
                  (plan_scope === 'catalogue_pro' ||
                    plan_scope === 'merchant_all_in_one')
              ),
              restaurant_food: Boolean(
                rawEnt.restaurant_food ??
                  (plan_scope === 'restaurant_pro' ||
                    plan_scope === 'merchant_all_in_one')
              ),
              real_estate_pro: Boolean(
                rawEnt.real_estate_pro ??
                  (plan_scope === 'real_estate_boost' ||
                    plan_scope === 'agent_pro' ||
                    plan_scope === 'merchant_all_in_one')
              ),
              max_monthly_orders: maxOrdersParsed,
            },
          };
        });
        setPlans(mappedPlans);
        setOverridePlanId((prev) => prev || mappedPlans[0]?.id || '');
      }

      if (!promoRes.error && Array.isArray(promoRes.data)) {
        setPromos(
          promoRes.data.map((row) => ({
            id: String(row.id),
            code: String(row.code ?? ''),
            description:
              typeof row.description === 'string' ? row.description : null,
            discount_type:
              row.discount_type === 'percent' ? 'percent' : 'flat',
            discount_value: Number(row.discount_value ?? 0),
            max_discount_inr:
              row.max_discount_inr === null ||
              row.max_discount_inr === undefined
                ? null
                : Number(row.max_discount_inr),
            min_order_inr: Number(row.min_order_inr ?? 0),
            applies_to: Array.isArray(row.applies_to)
              ? row.applies_to.map((v: unknown) => String(v))
              : [],
            max_uses:
              row.max_uses === null || row.max_uses === undefined
                ? null
                : Number(row.max_uses),
            used_count: Number(row.used_count ?? 0),
            starts_at: String(row.starts_at ?? new Date().toISOString()),
            expires_at:
              typeof row.expires_at === 'string' ? row.expires_at : null,
            is_active: Boolean(row.is_active),
            is_global: Boolean(row.is_global ?? true),
            target_hub_ids: Array.isArray(row.target_hub_ids)
              ? row.target_hub_ids.map(String)
              : [],
            created_at: String(row.created_at ?? new Date().toISOString()),
          }))
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAllTables();
    });
  }, [loadAllTables]);

  const planSelectOptions = useMemo<CustomSelectOption[]>(
    () =>
      plans.map((p) => ({
        value: p.id,
        label: `${p.name} (₹${p.price_inr} / ${p.duration_days}d)`,
        description: `${p.plan_scope.replace(/_/g, ' ')} · ${p.max_active_bulletins} active · ${p.max_monthly_posts}/mo`,
      })),
    [plans]
  );

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    return plans.filter((p) => {
      if (planScopeFilter !== 'all' && p.plan_scope !== planScopeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.plan_scope.toLowerCase().includes(q)
      );
    });
  }, [plans, planSearch, planScopeFilter]);

  // 1. Save Pricing Surcharges + sync legacy bulletin_pay_per_post
  const handleSaveSurcharges = async () => {
    const okConfirm = await confirmFinancialSave({
      title: 'Apply Platform Surcharge Changes?',
      description:
        'Updates Fragile Crate, Bulk Sack, LPG surcharge & Single Bulletin Pass pricing platform-wide.',
      confirmLabel: 'Save Surcharges',
      variant: 'warning',
    });
    if (!okConfirm) return;
    setSavingSurcharges(true);
    try {
      const normalized = normalizePricingSurcharges(surcharges);
      const ok = await onSavePlatformSetting(
        'pricing_surcharges',
        normalized,
        'Pricing surcharges & bulletin pass rate saved.'
      );
      if (ok) {
        // Keep legacy bulletin_pay_per_post key in sync for older readers
        await supabase.from('platform_settings').upsert(
          {
            key: 'bulletin_pay_per_post',
            value: {
              price_inr: normalized.bulletin_single_post_inr,
              duration_days: normalized.bulletin_single_post_days,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
        await refreshGlobalConfig();
      }
    } finally {
      setSavingSurcharges(false);
    }
  };

  // 2. Save Vehicle Type Row
  const handleSaveVehicle = async (v: VehicleTypeRow) => {
    const okConfirm = await confirmFinancialSave({
      title: `Save Rate Card for "${v.name}"?`,
      description: `Base ₹${v.base_fare_inr}, ₹${v.per_km_rate_inr}/km, ${
        v.is_active ? 'Active' : 'Disabled'
      }. Immediately affects live Pick N Drop quotes.`,
      confirmLabel: 'Save Rate Card',
      variant: 'warning',
    });
    if (!okConfirm) return;
    setSavingRowId(`veh:${v.id}`);
    setAppStatus('saving', `Updating ${v.name}...`);
    try {
      const { error } = await supabase
        .from('vehicle_types')
        .update({
          base_fare_inr: Number(v.base_fare_inr) || 0,
          per_km_rate_inr: Number(v.per_km_rate_inr) || 0,
          wait_per_10min_inr: Number(v.wait_per_10min_inr) || 0,
          free_wait_minutes: Number(v.free_wait_minutes) || 0,
          two_way_multiplier: Number(v.two_way_multiplier) || 1.75,
          max_weight_kg: Number(v.max_weight_kg) || 20,
          supported_modes: v.supported_modes,
          is_active: v.is_active,
        })
        .eq('id', v.id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setAppStatus('success', `${v.name} rate card saved.`);
      onNotify?.({ type: 'success', text: `${v.name} rate card updated.` });
      await refreshGlobalConfig();
    } finally {
      setSavingRowId(null);
    }
  };

  // 3. Save Subscription Plan Row
  const handleSavePlan = async (plan: SubscriptionPlanRow) => {
    setSavingRowId(`plan:${plan.id}`);
    setAppStatus('saving', `Saving ${plan.name}...`);
    try {
      const { error } = await supabase
        .from('subscription_plans')
        .update({
          name: plan.name.trim() || plan.slug,
          price_inr: Math.max(0, Math.round(Number(plan.price_inr) || 0)),
          duration_days: Math.max(
            1,
            Math.round(Number(plan.duration_days) || 30)
          ),
          max_active_bulletins: Math.max(
            1,
            Math.round(Number(plan.max_active_bulletins) || 1)
          ),
          max_monthly_posts: Math.max(
            1,
            Math.round(Number(plan.max_monthly_posts) || 1)
          ),
          max_images_per_post: Math.max(
            1,
            Math.round(Number(plan.max_images_per_post) || 1)
          ),
          allow_youtube: plan.allow_youtube,
          is_active: plan.is_active,
          plan_scope: plan.plan_scope,
          entitlements: {
            print_ordering: Boolean(plan.entitlements.print_ordering),
            custom_digital_quotes: Boolean(
              plan.entitlements.custom_digital_quotes
            ),
            escrow_enabled: Boolean(plan.entitlements.escrow_enabled),
            booking_venues: Boolean(plan.entitlements.booking_venues),
            hotel_stays: Boolean(plan.entitlements.hotel_stays),
            shop_catalogue: Boolean(plan.entitlements.shop_catalogue),
            restaurant_food: Boolean(plan.entitlements.restaurant_food),
            real_estate_pro: Boolean(plan.entitlements.real_estate_pro),
            max_monthly_orders:
              plan.entitlements.max_monthly_orders &&
              plan.entitlements.max_monthly_orders > 0
                ? Math.round(plan.entitlements.max_monthly_orders)
                : null,
          },
        })
        .eq('id', plan.id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setAppStatus('success', `${plan.name} plan saved.`);
      onNotify?.({ type: 'success', text: `${plan.name} plan updated.` });
      await refreshGlobalConfig();
    } finally {
      setSavingRowId(null);
    }
  };

  // 4. Search Users & Load Subscriptions for Override
  const handleSearchUsers = async () => {
    const q = userQuery.trim();
    if (!q) {
      setMatchedUsers([]);
      return;
    }
    setSearchingUsers(true);
    try {
      const safeQ = q.replace(/[%_,]/g, '');
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, name, phone, role')
        .or(
          `full_name.ilike.%${safeQ}%,name.ilike.%${safeQ}%,email.ilike.%${safeQ}%,phone.ilike.%${safeQ}%`
        )
        .limit(10);

      if (error) {
        onNotify?.({ type: 'error', text: error.message });
        return;
      }
      setMatchedUsers((data ?? []) as MatchedUserProfile[]);
    } finally {
      setSearchingUsers(false);
    }
  };

  const loadUserSubscriptions = async (user: MatchedUserProfile) => {
    setSelectedUser(user);
    setOverrideSubId(null);
    setLoadingUserSubs(true);
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(
          'id, user_id, plan_id, status, starts_at, expires_at, payment_ref, created_at'
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!error && Array.isArray(data)) {
        const rows = data as UserSubscriptionRow[];
        setUserSubs(rows);
        if (rows[0]) {
          const latest = rows[0];
          setOverrideSubId(latest.id);
          if (latest.plan_id) setOverridePlanId(latest.plan_id);
          setOverrideStatus(latest.status || 'active');
          setOverrideStartsAt(
            toDatetimeLocalValue(latest.starts_at || new Date().toISOString())
          );
          const fallbackExp = new Date();
          fallbackExp.setDate(fallbackExp.getDate() + 30);
          setOverrideExpiresAt(
            toDatetimeLocalValue(latest.expires_at || fallbackExp.toISOString())
          );
        } else {
          const now = new Date();
          const exp = new Date();
          exp.setDate(exp.getDate() + 30);
          setOverrideStatus('active');
          setOverrideStartsAt(toDatetimeLocalValue(now.toISOString()));
          setOverrideExpiresAt(toDatetimeLocalValue(exp.toISOString()));
        }
      }
    } finally {
      setLoadingUserSubs(false);
    }
  };

  const applyDurationPreset = (days: number) => {
    const startDate = overrideStartsAt
      ? new Date(overrideStartsAt)
      : new Date();
    const validStart = Number.isNaN(startDate.getTime())
      ? new Date()
      : startDate;
    const endDate = new Date(validStart.getTime() + days * 24 * 60 * 60 * 1000);
    setOverrideStartsAt(toDatetimeLocalValue(validStart.toISOString()));
    setOverrideExpiresAt(toDatetimeLocalValue(endDate.toISOString()));
  };

  const handleSaveUserSubOverride = async () => {
    if (!selectedUser) return;
    if (!overridePlanId) {
      onNotify?.({ type: 'error', text: 'Select a subscription plan first.' });
      return;
    }
    const startsIso = fromDatetimeLocalToIso(overrideStartsAt);
    const expiresIso = fromDatetimeLocalToIso(overrideExpiresAt);
    if (!startsIso || !expiresIso) {
      onNotify?.({
        type: 'error',
        text: 'Provide valid start and expiry date/time values.',
      });
      return;
    }

    setSavingOverride(true);
    setAppStatus('saving', 'Updating user subscription...');
    try {
      const { error } = await supabase.rpc(
        'superadmin_override_user_subscription',
        {
          p_user_id: selectedUser.id,
          p_plan_id: overridePlanId,
          p_starts_at: startsIso,
          p_expires_at: expiresIso,
          p_status: overrideStatus,
          p_subscription_id: overrideSubId,
        }
      );

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      // Pass V4: Persist tri-state Super-Admin entitlement_overrides JSONB onto user_subscriptions
      const featuresPayload: Record<string, boolean> = {};
      for (const [key, state] of Object.entries(overrideFeatureStates)) {
        if (state === 'enable') featuresPayload[key] = true;
        else if (state === 'disable') featuresPayload[key] = false;
      }
      const limitsPayload: Record<string, number> = {};
      for (const [key, rawVal] of Object.entries(overrideLimitValues)) {
        const trimmed = rawVal.trim();
        if (trimmed === '') continue;
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isFinite(parsed)) {
          limitsPayload[key] = parsed;
        }
      }
      const hasAnyOverrides =
        Object.keys(featuresPayload).length > 0 ||
        Object.keys(limitsPayload).length > 0;

      const targetSubQuery = overrideSubId
        ? supabase
            .from('user_subscriptions')
            .update({
              entitlement_overrides: hasAnyOverrides
                ? { features: featuresPayload, limits: limitsPayload }
                : {},
            })
            .eq('id', overrideSubId)
        : supabase
            .from('user_subscriptions')
            .update({
              entitlement_overrides: hasAnyOverrides
                ? { features: featuresPayload, limits: limitsPayload }
                : {},
            })
            .eq('user_id', selectedUser.id)
            .eq('plan_id', overridePlanId);
      await targetSubQuery;

      setAppStatus('success', 'User subscription override applied.');
      onNotify?.({
        type: 'success',
        text: `Updated subscription for ${
          selectedUser.full_name || selectedUser.name || selectedUser.email
        }.`,
      });
      await loadUserSubscriptions(selectedUser);
    } finally {
      setSavingOverride(false);
    }
  };

  // 5. Promo Codes CRUD
  const handleCreatePromo = async () => {
    const code = newPromoCode.trim().toUpperCase();
    if (!code) {
      onNotify?.({ type: 'error', text: 'Promo code is required.' });
      return;
    }
    const valueNum = Number(newPromoValue);
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      onNotify?.({ type: 'error', text: 'Discount value must be > 0.' });
      return;
    }
    if (newPromoApplies.length === 0) {
      onNotify?.({
        type: 'error',
        text: 'Select at least one module this promo applies to.',
      });
      return;
    }

    setCreatingPromo(true);
    setAppStatus('saving', `Creating promo ${code}...`);
    try {
      const { error } = await supabase.from('promo_codes').insert({
        code,
        description: newPromoDesc.trim() || null,
        discount_type: newPromoType,
        discount_value: Math.round(valueNum),
        max_discount_inr: newPromoMaxDisc.trim()
          ? Math.max(0, Math.round(Number(newPromoMaxDisc)))
          : null,
        min_order_inr: Math.max(0, Math.round(Number(newPromoMinOrder) || 0)),
        applies_to: newPromoApplies,
        max_uses: newPromoMaxUses.trim()
          ? Math.max(1, Math.round(Number(newPromoMaxUses)))
          : null,
        expires_at: fromDatetimeLocalToIso(newPromoExpiresAt),
        is_global: newPromoIsGlobal,
        target_hub_ids: newPromoIsGlobal ? [] : newPromoHubIds,
        is_active: true,
      });

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setNewPromoCode('');
      setNewPromoDesc('');
      setNewPromoValue('25');
      setNewPromoMaxDisc('');
      setNewPromoMinOrder('0');
      setNewPromoMaxUses('');
      setNewPromoExpiresAt('');
      setNewPromoIsGlobal(true);
      setNewPromoHubIds([]);

      setAppStatus('success', `Promo ${code} created.`);
      onNotify?.({ type: 'success', text: `Promo code ${code} created.` });
      await loadAllTables();
    } finally {
      setCreatingPromo(false);
    }
  };

  const handleSavePromo = async (promo: PromoCodeRecord) => {
    const okConfirm = await confirmFinancialSave({
      title: `Save Promo Code "${promo.code}"?`,
      description:
        'Updates discount value, minimum order threshold, hub scope & active status immediately.',
      confirmLabel: 'Save Promo',
      variant: 'warning',
    });
    if (!okConfirm) return;
    setSavingRowId(`promo:${promo.id}`);
    setAppStatus('saving', `Saving ${promo.code}...`);
    try {
      const { error } = await supabase
        .from('promo_codes')
        .update({
          code: promo.code.trim().toUpperCase(),
          description: promo.description?.trim() || null,
          discount_type: promo.discount_type,
          discount_value: Math.max(1, Math.round(promo.discount_value || 1)),
          max_discount_inr:
            promo.max_discount_inr === null
              ? null
              : Math.max(0, Math.round(promo.max_discount_inr)),
          min_order_inr: Math.max(0, Math.round(promo.min_order_inr || 0)),
          applies_to: promo.applies_to,
          max_uses:
            promo.max_uses === null
              ? null
              : Math.max(1, Math.round(promo.max_uses)),
          expires_at: promo.expires_at,
          is_global: promo.is_global ?? true,
          target_hub_ids: promo.target_hub_ids ?? [],
          is_active: promo.is_active,
        })
        .eq('id', promo.id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setAppStatus('success', `Promo ${promo.code} updated.`);
      onNotify?.({ type: 'success', text: `Promo ${promo.code} saved.` });
    } finally {
      setSavingRowId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* SECTION A: SURCHARGES & SINGLE POST PASS */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Handling Surcharges & Single Bulletin Pass
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Live add-on fees for Pick N Drop and pay-per-post Bulletin passes.
            </p>
          </div>
          <button
            type="button"
            disabled={savingSurcharges}
            onClick={handleSaveSurcharges}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {savingSurcharges ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Surcharges
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase dark:text-slate-400">
              Fragile Crate (₹)
            </span>
            <input
              type="number"
              min={0}
              value={surcharges.fragile_crate_inr}
              onChange={(e) =>
                setSurcharges((prev) => ({
                  ...prev,
                  fragile_crate_inr: Number(e.target.value) || 0,
                }))
              }
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase dark:text-slate-400">
              Bulk Sack (₹)
            </span>
            <input
              type="number"
              min={0}
              value={surcharges.bulk_sack_inr}
              onChange={(e) =>
                setSurcharges((prev) => ({
                  ...prev,
                  bulk_sack_inr: Number(e.target.value) || 0,
                }))
              }
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase dark:text-slate-400">
              Extra LPG Cyl (₹)
            </span>
            <input
              type="number"
              min={0}
              value={surcharges.extra_cylinder_inr}
              onChange={(e) =>
                setSurcharges((prev) => ({
                  ...prev,
                  extra_cylinder_inr: Number(e.target.value) || 0,
                }))
              }
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase dark:text-slate-400">
              Single Post Price (₹)
            </span>
            <input
              type="number"
              min={1}
              value={surcharges.bulletin_single_post_inr}
              onChange={(e) =>
                setSurcharges((prev) => ({
                  ...prev,
                  bulletin_single_post_inr: Number(e.target.value) || 1,
                }))
              }
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase dark:text-slate-400">
              Single Post Days
            </span>
            <input
              type="number"
              min={1}
              value={surcharges.bulletin_single_post_days}
              onChange={(e) =>
                setSurcharges((prev) => ({
                  ...prev,
                  bulletin_single_post_days: Number(e.target.value) || 1,
                }))
              }
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>
        </div>
      </div>

      {/* SECTION B: VEHICLE RATE CARDS */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <Truck className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              Vehicle Rate Cards ({vehicles.length})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Configure Pick N Drop & fleet fare tables per vehicle class.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAllTables()}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Reload
          </button>
        </div>

        {isLoading && vehicles.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading rate cards...
          </div>
        ) : (
          <div className="space-y-2.5">
            {vehicles.map((v) => {
              const isRowSaving = savingRowId === `veh:${v.id}`;
              return (
                <div
                  key={v.id}
                  className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {v.name}
                      </span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {v.slug}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? { ...item, is_active: !item.is_active }
                                : item
                            )
                          )
                        }
                        className={`h-7 rounded-md px-2 text-[11px] font-semibold transition ${
                          v.is_active
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {v.is_active ? 'Active' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        disabled={isRowSaving}
                        onClick={() => void handleSaveVehicle(v)}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500"
                      >
                        {isRowSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Save
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-medium text-slate-500">
                        Base ₹
                      </span>
                      <input
                        type="number"
                        value={v.base_fare_inr}
                        onChange={(e) =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? {
                                    ...item,
                                    base_fare_inr: Number(e.target.value) || 0,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-medium text-slate-500">
                        Per KM ₹
                      </span>
                      <input
                        type="number"
                        step="0.5"
                        value={v.per_km_rate_inr}
                        onChange={(e) =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? {
                                    ...item,
                                    per_km_rate_inr:
                                      Number(e.target.value) || 0,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-medium text-slate-500">
                        Wait ₹/10m
                      </span>
                      <input
                        type="number"
                        value={v.wait_per_10min_inr}
                        onChange={(e) =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? {
                                    ...item,
                                    wait_per_10min_inr:
                                      Number(e.target.value) || 0,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-medium text-slate-500">
                        Free Wait (m)
                      </span>
                      <input
                        type="number"
                        value={v.free_wait_minutes}
                        onChange={(e) =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? {
                                    ...item,
                                    free_wait_minutes:
                                      Number(e.target.value) || 0,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-medium text-slate-500">
                        2-Way Mult
                      </span>
                      <input
                        type="number"
                        step="0.05"
                        value={v.two_way_multiplier}
                        onChange={(e) =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? {
                                    ...item,
                                    two_way_multiplier:
                                      Number(e.target.value) || 1,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-medium text-slate-500">
                        Max Kg
                      </span>
                      <input
                        type="number"
                        value={v.max_weight_kg}
                        onChange={(e) =>
                          setVehicles((prev) =>
                            prev.map((item) =>
                              item.id === v.id
                                ? {
                                    ...item,
                                    max_weight_kg: Number(e.target.value) || 0,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-500">
                      Modes:
                    </span>
                    {SERVICE_MODES.map((m) => {
                      const active = v.supported_modes.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setVehicles((prev) =>
                              prev.map((item) => {
                                if (item.id !== v.id) return item;
                                const nextModes = active
                                  ? item.supported_modes.filter(
                                      (x) => x !== m.id
                                    )
                                  : [...item.supported_modes, m.id];
                                return {
                                  ...item,
                                  supported_modes:
                                    nextModes.length > 0 ? nextModes : [m.id],
                                };
                              })
                            )
                          }
                          className={`h-6 rounded px-2 text-[10px] font-semibold transition ${
                            active
                              ? 'bg-sky-600 text-white'
                              : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                          }`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION C: SUBSCRIPTION PLANS (BULLETIN & PRINT PRO) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
            <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Subscription Plans — Bulletin &amp; Print Pro ({plans.length})
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Configure Bulletin, Print &amp; Digital Pro, and Merchant Bundle
            pricing, plan scope, and print entitlements without SQL edits.
          </p>
        </div>

        <WorkspaceTableToolbar
          searchQuery={planSearch}
          onSearchChange={setPlanSearch}
          searchPlaceholder="Search plan name or slug…"
          filteredCount={filteredPlans.length}
          totalCount={plans.length}
          countLabel="plans"
          hasActiveFilters={Boolean(planSearch || planScopeFilter !== 'all')}
          onResetFilters={() => {
            setPlanSearch('');
            setPlanScopeFilter('all');
          }}
        >
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {(
              [
                { id: 'all', label: 'All Scopes' },
                { id: 'bulletin', label: 'Bulletin' },
                { id: 'print_pro', label: 'Print Pro' },
                { id: 'booking_pro', label: 'Booking Pro' },
                { id: 'stay_pro', label: 'Stay Pro' },
                { id: 'catalogue_pro', label: 'Catalogue Pro' },
                { id: 'restaurant_pro', label: 'Restaurant Pro' },
                { id: 'real_estate_boost', label: 'Property Boost' },
                { id: 'agent_pro', label: 'Agent Pro' },
                { id: 'merchant_bundle', label: 'Merchant Bundle' },
                { id: 'merchant_all_in_one', label: 'All-In-One' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setPlanScopeFilter(pill.id)}
                className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  planScopeFilter === pill.id
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <div className="space-y-2.5">
          {filteredPlans.map((plan) => {
            const isRowSaving = savingRowId === `plan:${plan.id}`;
            const isPrintCapableScope =
              plan.plan_scope === 'print_pro' ||
              plan.plan_scope === 'merchant_bundle';
            return (
              <div
                key={plan.id}
                className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 space-y-2.5 dark:border-slate-800 dark:bg-slate-950/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={plan.name}
                      onChange={(e) =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? { ...p, name: e.target.value }
                              : p
                          )
                        )
                      }
                      className="h-8 w-44 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {plan.slug}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        plan.plan_scope === 'print_pro'
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300'
                          : plan.plan_scope === 'merchant_bundle'
                            ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                      }`}
                    >
                      {plan.plan_scope.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? { ...p, allow_youtube: !p.allow_youtube }
                              : p
                          )
                        )
                      }
                      className={`h-7 rounded-md px-2 text-[10px] font-semibold cursor-pointer ${
                        plan.allow_youtube
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      YouTube: {plan.allow_youtube ? 'ON' : 'OFF'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? { ...p, is_active: !p.is_active }
                              : p
                          )
                        )
                      }
                      className={`h-7 rounded-md px-2 text-[10px] font-semibold cursor-pointer ${
                        plan.is_active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {plan.is_active ? 'Active' : 'Hidden'}
                    </button>
                    <button
                      type="button"
                      disabled={isRowSaving}
                      onClick={() => void handleSavePlan(plan)}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500 cursor-pointer"
                    >
                      {isRowSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="space-y-0.5 col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-medium text-slate-500">
                      Plan Scope
                    </span>
                    <CustomSelectModal
                      label="Plan Scope"
                      options={PLAN_SCOPE_OPTIONS}
                      value={plan.plan_scope}
                      onChange={(val) =>
                        setPlans((prev) =>
                          prev.map((p) => {
                            if (p.id !== plan.id) return p;
                            const nextScope = val as PlanScope;
                            const enablePrint =
                              nextScope === 'print_pro' ||
                              nextScope === 'merchant_bundle';
                            return {
                              ...p,
                              plan_scope: nextScope,
                              entitlements: {
                                ...p.entitlements,
                                print_ordering: enablePrint
                                  ? true
                                  : p.entitlements.print_ordering,
                              },
                            };
                          })
                        )
                      }
                    />
                  </div>
                  <label className="space-y-0.5">
                    <span className="text-[10px] font-medium text-slate-500">
                      Price ₹
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={plan.price_inr}
                      onChange={(e) =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? { ...p, price_inr: Number(e.target.value) || 0 }
                              : p
                          )
                        )
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] font-medium text-slate-500">
                      Duration (days)
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={plan.duration_days}
                      onChange={(e) =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? {
                                  ...p,
                                  duration_days: Number(e.target.value) || 1,
                                }
                              : p
                          )
                        )
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] font-medium text-slate-500">
                      Max Active
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={plan.max_active_bulletins}
                      onChange={(e) =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? {
                                  ...p,
                                  max_active_bulletins:
                                    Number(e.target.value) || 1,
                                }
                              : p
                          )
                        )
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] font-medium text-slate-500">
                      Monthly Posts
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={plan.max_monthly_posts}
                      onChange={(e) =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? {
                                  ...p,
                                  max_monthly_posts:
                                    Number(e.target.value) || 1,
                                }
                              : p
                          )
                        )
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] font-medium text-slate-500">
                      Images/Post
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={plan.max_images_per_post}
                      onChange={(e) =>
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? {
                                  ...p,
                                  max_images_per_post:
                                    Number(e.target.value) || 1,
                                }
                              : p
                          )
                        )
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                </div>

                {/* Print & Digital Pro Entitlements Strip */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2 ${
                    isPrintCapableScope
                      ? 'border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/20'
                      : 'border-slate-200/80 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
                      Entitlements:
                    </span>
                    {(
                      [
                        {
                          key: 'print_ordering',
                          label: 'Print Ordering',
                        },
                        {
                          key: 'custom_digital_quotes',
                          label: 'Custom Digital Quotes',
                        },
                        {
                          key: 'escrow_enabled',
                          label: 'Escrow Enabled',
                        },
                        {
                          key: 'booking_venues',
                          label: 'Booking Venues',
                        },
                        {
                          key: 'hotel_stays',
                          label: 'Hotel Stays',
                        },
                        {
                          key: 'shop_catalogue',
                          label: 'Shop Catalogue',
                        },
                        {
                          key: 'restaurant_food',
                          label: 'Restaurant & Food',
                        },
                        {
                          key: 'real_estate_pro',
                          label: 'Real Estate Pro',
                        },
                      ] as const
                    ).map((ent) => {
                      const active = Boolean(plan.entitlements[ent.key]);
                      return (
                        <button
                          key={ent.key}
                          type="button"
                          onClick={() =>
                            setPlans((prev) =>
                              prev.map((p) =>
                                p.id === plan.id
                                  ? {
                                      ...p,
                                      entitlements: {
                                        ...p.entitlements,
                                        [ent.key]: !p.entitlements[ent.key],
                                      },
                                    }
                                  : p
                              )
                            )
                          }
                          className={`h-7 rounded-md px-2 text-[10px] font-bold transition cursor-pointer ${
                            active
                              ? 'bg-sky-600 text-white'
                              : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {ent.label}: {active ? 'ON' : 'OFF'}
                        </button>
                      );
                    })}
                  </div>

                  <label className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      Max Monthly Orders:
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={plan.entitlements.max_monthly_orders ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setPlans((prev) =>
                          prev.map((p) =>
                            p.id === plan.id
                              ? {
                                  ...p,
                                  entitlements: {
                                    ...p.entitlements,
                                    max_monthly_orders: raw
                                      ? Math.max(1, Number(raw) || 1)
                                      : null,
                                  },
                                }
                              : p
                          )
                        );
                      }}
                      placeholder="Unlimited"
                      className="h-7 w-24 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION D: USER SUBSCRIPTION DATE/TIME OVERRIDE */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
            <CalendarClock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            User Subscription Date & Time Override
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Search any member to grant, extend, pause, or override exact start
            and expiry timestamps.
          </p>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearchUsers();
              }}
              placeholder="Search user by name, email, or phone..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-8 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <button
            type="button"
            disabled={searchingUsers}
            onClick={() => void handleSearchUsers()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {searchingUsers ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Find User
          </button>
        </div>

        {matchedUsers.length > 0 && (
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {matchedUsers.map((u) => {
              const isSelected = selectedUser?.id === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void loadUserSubscriptions(u)}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition ${
                    isSelected
                      ? 'border-violet-500 bg-violet-50/70 dark:border-violet-500 dark:bg-violet-950/40'
                      : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-slate-900 dark:text-white">
                      {u.full_name || u.name || 'Unnamed User'}
                    </p>
                    <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                      {u.email || u.phone || u.id.slice(0, 8)}
                    </p>
                  </div>
                  <span className="ml-2 shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {u.role || 'visitor'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedUser && (
          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/60 dark:bg-violet-950/20">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <UserCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {selectedUser.full_name ||
                    selectedUser.name ||
                    selectedUser.email}
                </span>
                <span className="text-[10px] text-slate-500">
                  ({selectedUser.email || selectedUser.phone})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOverrideSubId(null)}
                className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                {overrideSubId
                  ? 'Switch to Grant New Record'
                  : 'Creating New Subscription Record'}
              </button>
            </div>

            {loadingUserSubs ? (
              <div className="py-3 text-xs text-slate-500">
                <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                Loading existing subscriptions...
              </div>
            ) : (
              userSubs.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {userSubs.map((sub) => {
                    const active = overrideSubId === sub.id;
                    const planName =
                      plans.find((p) => p.id === sub.plan_id)?.name || 'Plan';
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          setOverrideSubId(sub.id);
                          if (sub.plan_id) setOverridePlanId(sub.plan_id);
                          setOverrideStatus(sub.status || 'active');
                          setOverrideStartsAt(
                            toDatetimeLocalValue(sub.starts_at)
                          );
                          setOverrideExpiresAt(
                            toDatetimeLocalValue(sub.expires_at)
                          );
                        }}
                        className={`rounded-md border px-2 py-1 text-left text-[10px] transition ${
                          active
                            ? 'border-violet-600 bg-violet-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        <span className="font-bold">{planName}</span> ·{' '}
                        <span className="uppercase">{sub.status}</span> · exp{' '}
                        {sub.expires_at
                          ? new Date(sub.expires_at).toLocaleDateString()
                          : 'n/a'}
                      </button>
                    );
                  })}
                </div>
              )
            )}

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-600 uppercase dark:text-slate-400">
                  Plan
                </span>
                <CustomSelectModal
                  label="Select Subscription Plan"
                  options={planSelectOptions}
                  value={overridePlanId}
                  onChange={setOverridePlanId}
                  placeholder="Choose plan"
                />
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-600 uppercase dark:text-slate-400">
                  Status
                </span>
                <CustomSelectModal
                  label="Subscription Status"
                  options={SUB_STATUS_OPTIONS}
                  value={overrideStatus}
                  onChange={setOverrideStatus}
                  placeholder="Status"
                />
              </div>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-600 uppercase dark:text-slate-400">
                  Starts At (Date & Time)
                </span>
                <input
                  type="datetime-local"
                  value={overrideStartsAt}
                  onChange={(e) => setOverrideStartsAt(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-semibold text-slate-600 uppercase dark:text-slate-400">
                  Expires At (Date & Time)
                </span>
                <input
                  type="datetime-local"
                  value={overrideExpiresAt}
                  onChange={(e) => setOverrideExpiresAt(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>

            {/* Pass V4: Tri-State Super-Admin Feature & Quota Overrides */}
            <div className="mt-3 rounded-xl border border-purple-500/30 bg-purple-500/5 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Customize Feature &amp; Quota Overrides
                  </span>
                  {(Object.values(overrideFeatureStates).some(
                    (v) => v !== 'inherit'
                  ) ||
                    Object.values(overrideLimitValues).some(
                      (v) => v.trim() !== ''
                    )) && (
                    <span
                      data-testid="superadmin-override-precedence-badge"
                      className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white"
                    >
                      Super-Admin Precedence Active
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setShowCustomOverridesPanel((prev) => !prev)
                  }
                  className="h-7 rounded-lg border border-purple-500/40 bg-white dark:bg-slate-900 px-2.5 text-[11px] font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
                >
                  {showCustomOverridesPanel
                    ? 'Hide Override Matrix'
                    : 'Customize Overrides'}
                </button>
              </div>

              {showCustomOverridesPanel && (
                <div className="space-y-3 pt-1">
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Super-Admin overrides ALWAYS take precedence over base
                    subscription plans — both Force Enable and Force Disable
                    apply immediately to the Owner and their delegated Staff.
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {SUBSCRIPTION_FEATURE_CATALOG.map((feat) => {
                      const state =
                        overrideFeatureStates[feat.key] || 'inherit';
                      return (
                        <div
                          key={feat.key}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                        >
                          <span className="truncate font-semibold text-slate-800 dark:text-slate-200">
                            {feat.label}
                          </span>
                          <div className="inline-flex shrink-0 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-[10px] font-bold">
                            {(
                              [
                                { id: 'inherit', label: 'Inherit' },
                                { id: 'enable', label: 'Enable' },
                                { id: 'disable', label: 'Disable' },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() =>
                                  setOverrideFeatureStates((prev) => ({
                                    ...prev,
                                    [feat.key]: opt.id,
                                  }))
                                }
                                className={`px-1.5 py-0.5 transition-colors ${
                                  state === opt.id
                                    ? opt.id === 'enable'
                                      ? 'bg-emerald-600 text-white'
                                      : opt.id === 'disable'
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-slate-700 text-white'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {SUBSCRIPTION_LIMIT_CATALOG.map((lim) => (
                      <label
                        key={lim.key}
                        className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] dark:border-slate-700 dark:bg-slate-900"
                      >
                        <span className="font-semibold text-slate-600 dark:text-slate-400 truncate">
                          {lim.label}
                        </span>
                        <input
                          type="number"
                          placeholder="Inherit (-1 = ∞)"
                          value={overrideLimitValues[lim.key] ?? ''}
                          onChange={(e) =>
                            setOverrideLimitValues((prev) => ({
                              ...prev,
                              [lim.key]: e.target.value,
                            }))
                          }
                          className="h-7 w-full rounded border border-slate-200 bg-slate-50 px-2 text-xs font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-500">
                  Quick Duration:
                </span>
                {[7, 30, 90, 365].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => applyDurationPreset(days)}
                    className="h-6 rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    +{days}d
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={savingOverride}
                onClick={() => void handleSaveUserSubOverride()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {savingOverride ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {overrideSubId
                  ? 'Update Subscription'
                  : 'Grant / Override Subscription'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION E: PROMO CODES MANAGER */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
            <BadgePercent className="h-4 w-4 text-rose-500" />
            Promo & Discount Codes ({promos.length})
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Create flat or percentage promo codes validated at payment intent
            creation.
          </p>
        </div>

        {/* Create new promo card */}
        <div className="mb-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="mb-2 flex items-center gap-1 text-[11px] font-bold text-slate-700 dark:text-slate-200">
            <Tag className="h-3.5 w-3.5 text-sky-600" />
            Create Promo Code
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              value={newPromoCode}
              onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
              placeholder="CODE (e.g. LAMKA50)"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newPromoDesc}
              onChange={(e) => setNewPromoDesc(e.target.value)}
              placeholder="Short description"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <CustomSelectModal
              label="Discount Type"
              options={DISCOUNT_TYPE_OPTIONS}
              value={newPromoType}
              onChange={(v) =>
                setNewPromoType(v === 'percent' ? 'percent' : 'flat')
              }
            />
            <input
              type="number"
              min={1}
              value={newPromoValue}
              onChange={(e) => setNewPromoValue(e.target.value)}
              placeholder={
                newPromoType === 'percent' ? 'Discount %' : 'Flat ₹ Off'
              }
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="number"
              min={0}
              value={newPromoMaxDisc}
              onChange={(e) => setNewPromoMaxDisc(e.target.value)}
              placeholder="Max discount ₹ (optional)"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="number"
              min={0}
              value={newPromoMinOrder}
              onChange={(e) => setNewPromoMinOrder(e.target.value)}
              placeholder="Min order ₹"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="number"
              min={1}
              value={newPromoMaxUses}
              onChange={(e) => setNewPromoMaxUses(e.target.value)}
              placeholder="Max uses (blank = ∞)"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="datetime-local"
              value={newPromoExpiresAt}
              onChange={(e) => setNewPromoExpiresAt(e.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-500">
                Applies to:
              </span>
              {PROMO_MODULES.map((mod) => {
                const checked = newPromoApplies.includes(mod.id);
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() =>
                      setNewPromoApplies((prev) =>
                        checked
                          ? prev.filter((x) => x !== mod.id)
                          : [...prev, mod.id]
                      )
                    }
                    className={`h-6 rounded px-2 text-[10px] font-semibold transition ${
                      checked
                        ? 'bg-sky-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                    }`}
                  >
                    {mod.label}
                  </button>
                );
              })}
            </div>

            {/* Hub Scope Selector */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                <Globe className="h-3 w-3" />
                Target:
              </span>
              <button
                type="button"
                onClick={() => {
                  setNewPromoIsGlobal(!newPromoIsGlobal);
                  if (!newPromoIsGlobal) setNewPromoHubIds([]);
                }}
                className={`h-6 rounded px-2 text-[10px] font-semibold transition ${
                  newPromoIsGlobal
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                Global (All Hubs)
              </button>

              {!newPromoIsGlobal &&
                hubs.map((hub) => {
                  const checked = newPromoHubIds.includes(hub.id);
                  return (
                    <button
                      key={hub.id}
                      type="button"
                      onClick={() =>
                        setNewPromoHubIds((prev) =>
                          checked ? prev.filter((id) => id !== hub.id) : [...prev, hub.id]
                        )
                      }
                      className={`h-6 rounded px-2 text-[10px] font-semibold transition ${
                        checked
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {hub.name}
                    </button>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={creatingPromo}
              onClick={() => void handleCreatePromo()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {creatingPromo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add Promo
            </button>
          </div>
        </div>

        {/* Existing promos list */}
        {promos.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400">
            No promo codes created yet.
          </p>
        ) : (
          <ResponsiveTableScroll
            minWidthClass="min-w-[620px]"
            showSwipeHint={true}
            swipeHintLabel="Swipe ↔ to view all promo settings and target modules"
          >
            <div className="space-y-2 p-1">
              {promos.map((promo) => {
                const isRowSaving = savingRowId === `promo:${promo.id}`;
                return (
                  <div
                    key={promo.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-slate-950/50"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white dark:bg-sky-600">
                          {promo.code}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          {promo.discount_type === 'percent'
                            ? `${promo.discount_value}% OFF`
                            : `₹${promo.discount_value} OFF`}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Used: {promo.used_count}
                          {promo.max_uses ? ` / ${promo.max_uses}` : ' / ∞'}
                        </span>
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-800 dark:bg-sky-950/70 dark:text-sky-300">
                          {promo.is_global !== false
                            ? 'Global'
                            : promo.target_hub_ids && promo.target_hub_ids.length > 0
                              ? `Hubs: ${promo.target_hub_ids
                                  .map((id) => hubs.find((h) => h.id === id)?.name || id)
                                  .join(', ')}`
                              : 'Global'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setPromos((prev) =>
                              prev.map((p) =>
                                p.id === promo.id
                                  ? { ...p, is_active: !p.is_active }
                                  : p
                              )
                            )
                          }
                          className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                            promo.is_active
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {promo.is_active ? 'Active' : 'Paused'}
                        </button>
                        <button
                          type="button"
                          disabled={isRowSaving}
                          onClick={() => void handleSavePromo(promo)}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600"
                        >
                          {isRowSaving ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Save className="h-3 w-3" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <input
                        type="text"
                        value={promo.description ?? ''}
                        onChange={(e) =>
                          setPromos((prev) =>
                            prev.map((p) =>
                              p.id === promo.id
                                ? { ...p, description: e.target.value }
                                : p
                            )
                          )
                        }
                        placeholder="Description"
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <input
                        type="number"
                        min={1}
                        value={promo.discount_value}
                        onChange={(e) =>
                          setPromos((prev) =>
                            prev.map((p) =>
                              p.id === promo.id
                                ? {
                                    ...p,
                                    discount_value: Number(e.target.value) || 1,
                                  }
                                : p
                            )
                          )
                        }
                        placeholder="Value"
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <input
                        type="number"
                        min={0}
                        value={promo.min_order_inr}
                        onChange={(e) =>
                          setPromos((prev) =>
                            prev.map((p) =>
                              p.id === promo.id
                                ? {
                                    ...p,
                                    min_order_inr: Number(e.target.value) || 0,
                                  }
                                : p
                            )
                          )
                        }
                        placeholder="Min Order ₹"
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <input
                        type="number"
                        min={1}
                        value={promo.max_uses ?? ''}
                        onChange={(e) =>
                          setPromos((prev) =>
                            prev.map((p) =>
                              p.id === promo.id
                                ? {
                                    ...p,
                                    max_uses: e.target.value.trim()
                                      ? Number(e.target.value)
                                      : null,
                                  }
                                : p
                            )
                          )
                        }
                        placeholder="Max uses"
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <input
                        type="datetime-local"
                        value={toDatetimeLocalValue(promo.expires_at)}
                        onChange={(e) =>
                          setPromos((prev) =>
                            prev.map((p) =>
                              p.id === promo.id
                                ? {
                                    ...p,
                                    expires_at: fromDatetimeLocalToIso(
                                      e.target.value
                                    ),
                                  }
                                : p
                            )
                          )
                        }
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {PROMO_MODULES.map((mod) => {
                        const active = promo.applies_to.includes(mod.id);
                        return (
                          <button
                            key={mod.id}
                            type="button"
                            onClick={() =>
                              setPromos((prev) =>
                                prev.map((p) => {
                                  if (p.id !== promo.id) return p;
                                  const next = active
                                    ? p.applies_to.filter((x) => x !== mod.id)
                                    : [...p.applies_to, mod.id];
                                  return { ...p, applies_to: next };
                                })
                              )
                            }
                            className={`h-5 rounded px-1.5 text-[10px] font-semibold ${
                              active
                                ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300'
                                : 'bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {mod.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ResponsiveTableScroll>
        )}
      </div>

      {/* Pass R6: Composable Plan Builder & Per-Business Entitlement Overrides */}
      <ComposablePlanBuilderSection />
      {confirmFinancialDialog}
    </div>
  );
}
