'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { PhoneInput } from '@/components/ui/PhoneInput';
import {
  AlertCircle,
  Building2,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Flag,
  Gift,
  GitMerge,
  Home,
  Landmark,
  Layers,
  Loader2,
  Lock,
  MapPin,
  Megaphone,
  Package,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  ToggleLeft,
  ToggleRight,
  Truck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  getPreviewHubSlugCookie,
  useAuth,
} from '@/lib/store';
import {
  useAppConfig,
  useHub,
} from '@/components/providers/AppConfigProvider';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { getSignedPodUrl } from '@/lib/supabase/storage';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { HubBookingsGovernancePanel } from '@/components/workspaces/bookings/HubBookingsGovernancePanel';
import { HubCommerceGovernancePanel } from '@/components/workspaces/commerce/HubCommerceGovernancePanel';
import { HubPrintGovernancePanel } from '@/components/workspaces/print/HubPrintGovernancePanel';
import { HubRealEstateGovernancePanel } from '@/components/workspaces/real-estate/HubRealEstateGovernancePanel';
import { CivicDirectoryManager } from '@/components/workspaces/civic/CivicDirectoryManager';
import { HubCommandOverviewCard } from '@/components/workspaces/HubCommandOverviewCard';
import { PartnerApplicationsPanel } from '@/components/workspaces/governance/PartnerApplicationsPanel';
import { ReferralsTrackingPanel } from '@/components/workspaces/governance/ReferralsTrackingPanel';
import { FeaturedPlacementsPanel } from '@/components/workspaces/governance/FeaturedPlacementsPanel';
import type {
  ModuleSwitchItem,
  OfficeAndContactConfig,
  OperationsConfig,
  ServiceHubRecord,
} from '@/lib/config/types';

export interface HubManagerWorkspaceProps {
  onOpenListingOnMap?: (listingId?: string) => void;
}

type HubWorkspaceTab =
  | 'overview'
  | 'applications'
  | 'referrals'
  | 'featured'
  | 'listings'
  | 'shops_food'
  | 'real_estate'
  | 'bookings_stays'
  | 'print_digital'
  | 'public_civic'
  | 'localities'
  | 'fleet'
  | 'bulletins'
  | 'payments'
  | 'audit_logs';

type ModuleSwitchKey = keyof OperationsConfig['module_switches'];

const MODULE_SWITCH_DEFINITIONS: Array<{
  key: ModuleSwitchKey;
  label: string;
  description: string;
}> = [
  {
    key: 'explore',
    label: 'Explore Directory & Map',
    description: 'Local places, businesses, real estate, and map discovery in this hub',
  },
  {
    key: 'marketplace',
    label: 'Local Marketplace',
    description: 'Product listings, shop items, and direct buyer enquiries in this hub',
  },
  {
    key: 'bulletin',
    label: 'Community Bulletin',
    description: 'Local announcements, jobs, notices, and events targeted to this hub',
  },
  {
    key: 'pick_n_drop',
    label: 'Pick N Drop Logistics',
    description: 'On-demand parcel, passenger, and LPG cylinder dispatches in this hub',
  },
  {
    key: 'vehicle_bookings',
    label: 'Charter & Seat Bookings',
    description: 'Scheduled taxi, 4WD charter, and inter-hub seat reservations',
  },
  {
    key: 'print_orders',
    label: 'Print & Digital Ordering',
    description: 'Online PDF/photo printing, custom digital quotes, and DD oodle Print counters in this hub',
  },
  {
    key: 'booking_venues',
    label: 'Venue & Turf Bookings',
    description: 'Online slot booking for sports turfs, event halls, and hourly/daily venues in this hub',
  },
  {
    key: 'hotel_stays',
    label: 'Hotels & Homestays',
    description: 'Nightly room reservations, live inventory, and hospitality stays in this hub',
  },
  {
    key: 'shop_orders',
    label: 'Shop Catalogue Orders',
    description: 'Local storefront basket ordering, counter pickup, and Pick N Drop shop delivery in this hub',
  },
  {
    key: 'food_orders',
    label: 'Restaurants & Food Orders',
    description: 'Digital restaurant menus, takeaway, hot-food Pick N Drop delivery, and table reservations in this hub',
  },
  {
    key: 'real_estate',
    label: 'Real Estate & Properties',
    description: 'Lightweight property listings, Patta/Site verification, 30-day freshness, and controlled site visits in this hub',
  },
];

interface HubListingRow {
  id: string;
  hub_id?: string | null;
  title: string;
  category: string;
  subcategory?: string | null;
  locality?: string | null;
  status: string;
  owner_name?: string | null;
  contact_phone?: string | null;
  created_at?: string | null;
}

interface HubProductRow {
  id: string;
  hub_id?: string | null;
  title: string;
  category: string;
  price_inr: number;
  stock_status?: string | null;
  is_active: boolean;
  seller_name?: string | null;
  seller_phone?: string | null;
  created_at?: string | null;
}

interface HubLocalityRow {
  id: string;
  hub_id: string;
  slug: string;
  display_name: string;
  aliases: string[];
  lat: number | null;
  lng: number | null;
  source: 'admin' | 'user_submitted' | 'google_reference' | string;
  status: 'verified' | 'pending' | 'merged' | string;
  merged_into_id?: string | null;
  usage_count: number;
  created_at?: string | null;
}

interface HubDriverRow {
  id: string;
  hub_id?: string | null;
  profile_id?: string | null;
  full_name: string;
  phone: string;
  license_number?: string | null;
  kyc_verified: boolean;
  is_available: boolean;
  rating?: number | null;
  total_trips?: number | null;
}

interface HubVehicleRow {
  id: string;
  hub_id?: string | null;
  driver_id?: string | null;
  vehicle_type_id?: string | null;
  plate_number: string;
  model_name?: string | null;
  rc_number?: string | null;
  is_active: boolean;
}

interface HubDeliveryOrderRow {
  id: string;
  order_code?: string | null;
  hub_id?: string | null;
  service_mode?: string | null;
  status: string;
  pickup_address: string;
  drop_address: string;
  item_category?: string | null;
  quoted_fare_inr: number;
  final_fare_inr?: number | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  upi_utr_ref?: string | null;
  pod_storage_path?: string | null;
  created_at?: string | null;
}

interface HubVehicleBookingRow {
  id: string;
  booking_code: string;
  hub_id?: string | null;
  origin_hub_id?: string | null;
  vehicle_listing_id: string;
  booking_type: string;
  seats_booked: number;
  trip_date: string;
  trip_time?: string | null;
  pickup_address: string;
  drop_address?: string | null;
  passenger_name?: string | null;
  passenger_phone?: string | null;
  total_fare_inr: number;
  advance_paid_inr: number;
  balance_due_inr: number;
  status: string;
  escrow_status?: string | null;
  created_at?: string | null;
}

interface HubBulletinReportRow {
  id: string;
  bulletin_id: string;
  reporter_id?: string | null;
  reason: string;
  details?: string | null;
  status: string;
  created_at?: string | null;
  bulletin_title?: string;
  bulletin_category?: string;
  bulletin_status?: string;
}

interface HubBulletinPassRow {
  id: string;
  user_id: string;
  amount_inr: number;
  duration_days: number;
  upi_utr_ref?: string | null;
  status: string;
  created_at?: string | null;
}

interface HubSubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  payment_ref?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}

interface HubPaymentIntentRow {
  id: string;
  intent_code: string;
  user_id: string;
  hub_id?: string | null;
  purpose: string;
  reference_id: string;
  amount_inr: number;
  base_amount_inr?: number | null;
  discount_inr?: number | null;
  convenience_fee_inr?: number | null;
  provider: string;
  upi_utr_ref?: string | null;
  status: string;
  created_at?: string | null;
}

export default function HubManagerWorkspace({
  onOpenListingOnMap,
}: HubManagerWorkspaceProps) {
  const {
    user: authUser,
    actual_role: actualRole,
    effective_role: effectiveRole,
    managedHubIds,
    hubManagerPermissions,
    canConfirmManualPaymentsByHub,
    canEditRatesByHub,
  } = useAuth();
  const { hubs, operations, office: globalOffice, refreshConfig } = useAppConfig();
  const { activeHub, switchHub } = useHub();
  const { setStatus } = useAppStatus();
  const { confirm: confirmDangerAction, dialog: confirmDangerDialog } =
    useConfirmDialog();

  const isSuperOrAdmin =
    actualRole === 'super_admin' || actualRole === 'admin';
  const isPreviewMode =
    isSuperOrAdmin && effectiveRole === 'hub_manager';

  // Determine hubs accessible to this Hub Manager (or all active hubs for Super-Admin / Admin preview)
  const accessibleHubs = useMemo<ServiceHubRecord[]>(() => {
    const activeServiceHubs = hubs.filter((h) => h.status === 'active');
    if (isSuperOrAdmin) {
      return activeServiceHubs.length > 0 ? activeServiceHubs : hubs;
    }
    if (managedHubIds.length > 0) {
      const matched = hubs.filter((h) => managedHubIds.includes(h.id));
      if (matched.length > 0) return matched;
    }
    return activeHub ? [activeHub] : activeServiceHubs;
  }, [hubs, isSuperOrAdmin, managedHubIds, activeHub]);

  const [selectedHubId, setSelectedHubId] = useState<string>(() => {
    const previewSlug = getPreviewHubSlugCookie();
    if (previewSlug) {
      const foundByPreview = hubs.find(
        (h) => h.slug.toLowerCase() === previewSlug.toLowerCase()
      );
      if (foundByPreview) return foundByPreview.id;
    }
    if (managedHubIds.length > 0) {
      const firstManaged = hubs.find((h) => h.id === managedHubIds[0]);
      if (firstManaged) return firstManaged.id;
    }
    return activeHub?.id || hubs[0]?.id || '';
  });

  // Keep selectedHubId valid when accessibleHubs hydrate
  useEffect(() => {
    if (accessibleHubs.length === 0) return;
    const exists = accessibleHubs.some((h) => h.id === selectedHubId);
    if (!exists) {
      const previewSlug = getPreviewHubSlugCookie();
      const matchedPreview = previewSlug
        ? accessibleHubs.find(
            (h) => h.slug.toLowerCase() === previewSlug.toLowerCase()
          )
        : null;
      const fallbackHub = matchedPreview || accessibleHubs[0];
      if (fallbackHub) {
        queueMicrotask(() => {
          setSelectedHubId(fallbackHub.id);
        });
      }
    }
  }, [accessibleHubs, selectedHubId]);

  const selectedHub = useMemo<ServiceHubRecord>(() => {
    return (
      accessibleHubs.find((h) => h.id === selectedHubId) ||
      accessibleHubs[0] ||
      activeHub
    );
  }, [accessibleHubs, selectedHubId, activeHub]);

  const activeSelectedHubId = selectedHub?.id || '';

  // Resolve payment confirmation and rate edit delegation flags for selectedHub
  const canConfirmManualPayments = useMemo<boolean>(() => {
    if (!activeSelectedHubId) return false;
    const permEntry = hubManagerPermissions?.[activeSelectedHubId];
    if (permEntry !== undefined) {
      return Boolean(permEntry.can_confirm_manual_payments);
    }
    return Boolean(canConfirmManualPaymentsByHub?.[activeSelectedHubId]);
  }, [activeSelectedHubId, hubManagerPermissions, canConfirmManualPaymentsByHub]);

  const canEditHubRates = useMemo<boolean>(() => {
    if (!activeSelectedHubId) return false;
    const permEntry = hubManagerPermissions?.[activeSelectedHubId];
    if (permEntry !== undefined) {
      return Boolean(permEntry.can_edit_rates);
    }
    return Boolean(canEditRatesByHub?.[activeSelectedHubId]);
  }, [activeSelectedHubId, hubManagerPermissions, canEditRatesByHub]);

  const canExecuteManualPaymentFulfillment =
    canConfirmManualPayments === true || actualRole === 'super_admin';

  const [activeTab, setActiveTab] = useState<HubWorkspaceTab>('overview');
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Tab 1: Overview & Switches state
  const [moduleSwitchesDraft, setModuleSwitchesDraft] = useState<
    Record<ModuleSwitchKey, ModuleSwitchItem>
  >(() => ({
    explore: {
      enabled:
        selectedHub?.module_switches?.explore?.enabled ??
        operations.module_switches.explore.enabled,
      pause_message:
        selectedHub?.module_switches?.explore?.pause_message ??
        operations.module_switches.explore.pause_message,
    },
    marketplace: {
      enabled:
        selectedHub?.module_switches?.marketplace?.enabled ??
        operations.module_switches.marketplace.enabled,
      pause_message:
        selectedHub?.module_switches?.marketplace?.pause_message ??
        operations.module_switches.marketplace.pause_message,
    },
    bulletin: {
      enabled:
        selectedHub?.module_switches?.bulletin?.enabled ??
        operations.module_switches.bulletin.enabled,
      pause_message:
        selectedHub?.module_switches?.bulletin?.pause_message ??
        operations.module_switches.bulletin.pause_message,
    },
    pick_n_drop: {
      enabled:
        selectedHub?.module_switches?.pick_n_drop?.enabled ??
        operations.module_switches.pick_n_drop.enabled,
      pause_message:
        selectedHub?.module_switches?.pick_n_drop?.pause_message ??
        operations.module_switches.pick_n_drop.pause_message,
    },
    vehicle_bookings: {
      enabled:
        selectedHub?.module_switches?.vehicle_bookings?.enabled ??
        operations.module_switches.vehicle_bookings.enabled,
      pause_message:
        selectedHub?.module_switches?.vehicle_bookings?.pause_message ??
        operations.module_switches.vehicle_bookings.pause_message,
    },
    print_orders: {
      enabled:
        selectedHub?.module_switches?.print_orders?.enabled ??
        operations.module_switches.print_orders.enabled,
      pause_message:
        selectedHub?.module_switches?.print_orders?.pause_message ??
        operations.module_switches.print_orders.pause_message,
    },
    booking_venues: {
      enabled:
        selectedHub?.module_switches?.booking_venues?.enabled ??
        operations.module_switches.booking_venues.enabled,
      pause_message:
        selectedHub?.module_switches?.booking_venues?.pause_message ??
        operations.module_switches.booking_venues.pause_message,
    },
    hotel_stays: {
      enabled:
        selectedHub?.module_switches?.hotel_stays?.enabled ??
        operations.module_switches.hotel_stays.enabled,
      pause_message:
        selectedHub?.module_switches?.hotel_stays?.pause_message ??
        operations.module_switches.hotel_stays.pause_message,
    },
    shop_orders: {
      enabled:
        selectedHub?.module_switches?.shop_orders?.enabled ??
        operations.module_switches.shop_orders.enabled,
      pause_message:
        selectedHub?.module_switches?.shop_orders?.pause_message ??
        operations.module_switches.shop_orders.pause_message,
    },
    food_orders: {
      enabled:
        selectedHub?.module_switches?.food_orders?.enabled ??
        operations.module_switches.food_orders.enabled,
      pause_message:
        selectedHub?.module_switches?.food_orders?.pause_message ??
        operations.module_switches.food_orders.pause_message,
    },
    real_estate: {
      enabled:
        selectedHub?.module_switches?.real_estate?.enabled ??
        operations.module_switches.real_estate.enabled,
      pause_message:
        selectedHub?.module_switches?.real_estate?.pause_message ??
        operations.module_switches.real_estate.pause_message,
    },
  }));
  const [isSavingSwitches, setIsSavingSwitches] = useState(false);

  const [officeContactDraft, setOfficeContactDraft] = useState<
    Partial<OfficeAndContactConfig>
  >(() => ({
    address: selectedHub?.office_contact?.address || globalOffice.address || '',
    phone: selectedHub?.office_contact?.phone || globalOffice.phone || '',
    whatsapp:
      selectedHub?.office_contact?.whatsapp || globalOffice.whatsapp || '',
    email: selectedHub?.office_contact?.email || globalOffice.email || '',
    operating_hours:
      selectedHub?.office_contact?.operating_hours ||
      globalOffice.operating_hours ||
      '',
  }));
  const [isSavingContact, setIsSavingContact] = useState(false);

  // Sync draft state when selectedHub changes
  useEffect(() => {
    if (!selectedHub) return;
    queueMicrotask(() => {
      setModuleSwitchesDraft({
        explore: {
          enabled:
            selectedHub.module_switches?.explore?.enabled ??
            operations.module_switches.explore.enabled,
          pause_message:
            selectedHub.module_switches?.explore?.pause_message ??
            operations.module_switches.explore.pause_message,
        },
        marketplace: {
          enabled:
            selectedHub.module_switches?.marketplace?.enabled ??
            operations.module_switches.marketplace.enabled,
          pause_message:
            selectedHub.module_switches?.marketplace?.pause_message ??
            operations.module_switches.marketplace.pause_message,
        },
        bulletin: {
          enabled:
            selectedHub.module_switches?.bulletin?.enabled ??
            operations.module_switches.bulletin.enabled,
          pause_message:
            selectedHub.module_switches?.bulletin?.pause_message ??
            operations.module_switches.bulletin.pause_message,
        },
        pick_n_drop: {
          enabled:
            selectedHub.module_switches?.pick_n_drop?.enabled ??
            operations.module_switches.pick_n_drop.enabled,
          pause_message:
            selectedHub.module_switches?.pick_n_drop?.pause_message ??
            operations.module_switches.pick_n_drop.pause_message,
        },
        vehicle_bookings: {
          enabled:
            selectedHub.module_switches?.vehicle_bookings?.enabled ??
            operations.module_switches.vehicle_bookings.enabled,
          pause_message:
            selectedHub.module_switches?.vehicle_bookings?.pause_message ??
            operations.module_switches.vehicle_bookings.pause_message,
        },
        print_orders: {
          enabled:
            selectedHub.module_switches?.print_orders?.enabled ??
            operations.module_switches.print_orders.enabled,
          pause_message:
            selectedHub.module_switches?.print_orders?.pause_message ??
            operations.module_switches.print_orders.pause_message,
        },
        booking_venues: {
          enabled:
            selectedHub.module_switches?.booking_venues?.enabled ??
            operations.module_switches.booking_venues.enabled,
          pause_message:
            selectedHub.module_switches?.booking_venues?.pause_message ??
            operations.module_switches.booking_venues.pause_message,
        },
        hotel_stays: {
          enabled:
            selectedHub.module_switches?.hotel_stays?.enabled ??
            operations.module_switches.hotel_stays.enabled,
          pause_message:
            selectedHub.module_switches?.hotel_stays?.pause_message ??
            operations.module_switches.hotel_stays.pause_message,
        },
        shop_orders: {
          enabled:
            selectedHub.module_switches?.shop_orders?.enabled ??
            operations.module_switches.shop_orders.enabled,
          pause_message:
            selectedHub.module_switches?.shop_orders?.pause_message ??
            operations.module_switches.shop_orders.pause_message,
        },
        food_orders: {
          enabled:
            selectedHub.module_switches?.food_orders?.enabled ??
            operations.module_switches.food_orders.enabled,
          pause_message:
            selectedHub.module_switches?.food_orders?.pause_message ??
            operations.module_switches.food_orders.pause_message,
        },
        real_estate: {
          enabled:
            selectedHub.module_switches?.real_estate?.enabled ??
            operations.module_switches.real_estate.enabled,
          pause_message:
            selectedHub.module_switches?.real_estate?.pause_message ??
            operations.module_switches.real_estate.pause_message,
        },
      });

      setOfficeContactDraft({
        address:
          selectedHub.office_contact?.address ||
          `${selectedHub.name} Branch Office, ${selectedHub.state}`,
        phone: selectedHub.office_contact?.phone || globalOffice.phone || '',
        whatsapp:
          selectedHub.office_contact?.whatsapp || globalOffice.whatsapp || '',
        email: selectedHub.office_contact?.email || globalOffice.email || '',
        operating_hours:
          selectedHub.office_contact?.operating_hours ||
          globalOffice.operating_hours ||
          'Mon–Sat, 8:00 AM – 8:00 PM',
      });
    });
  }, [selectedHub, operations.module_switches, globalOffice]);

  // Tab 2: Listings & Products state
  const [hubListings, setHubListings] = useState<HubListingRow[]>([]);
  const [hubProducts, setHubProducts] = useState<HubProductRow[]>([]);
  const [catalogViewFilter, setCatalogViewFilter] = useState<
    'all' | 'listings' | 'products'
  >('all');
  const [catalogStatusFilter, setCatalogStatusFilter] = useState<string>('all');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [busyCatalogId, setBusyCatalogId] = useState<string | null>(null);

  // Tab 3: Locality Pool state
  const [hubLocalitiesList, setHubLocalitiesList] = useState<HubLocalityRow[]>(
    []
  );
  const [localityStatusFilter, setLocalityStatusFilter] = useState<
    'all' | 'pending' | 'verified' | 'merged'
  >('all');
  const [localitySearch, setLocalitySearch] = useState<string>('');
  const [editingLocalityId, setEditingLocalityId] = useState<string | null>(
    null
  );
  const [editingLocalityName, setEditingLocalityName] = useState<string>('');
  const [mergeTargetBySourceId, setMergeTargetBySourceId] = useState<
    Record<string, string>
  >({});
  const [busyLocalityId, setBusyLocalityId] = useState<string | null>(null);
  const [newLocalityName, setNewLocalityName] = useState<string>('');
  const [newLocalityAliases, setNewLocalityAliases] = useState<string>('');
  const [isAddingLocality, setIsAddingLocality] = useState<boolean>(false);

  // Tab 4: Pick N Drop & Fleet state
  const [fleetSubSection, setFleetSubSection] = useState<
    'orders' | 'bookings' | 'drivers' | 'vehicles'
  >('orders');
  const [hubDrivers, setHubDrivers] = useState<HubDriverRow[]>([]);
  const [hubVehicles, setHubVehicles] = useState<HubVehicleRow[]>([]);
  const [hubOrders, setHubOrders] = useState<HubDeliveryOrderRow[]>([]);
  const [hubBookings, setHubBookings] = useState<HubVehicleBookingRow[]>([]);
  const [assignDriverByOrder, setAssignDriverByOrder] = useState<
    Record<string, string>
  >({});
  const [assignVehicleByOrder, setAssignVehicleByOrder] = useState<
    Record<string, string>
  >({});
  const [signedPodUrlByOrder, setSignedPodUrlByOrder] = useState<
    Record<string, string>
  >({});
  const [busyFleetItemId, setBusyFleetItemId] = useState<string | null>(null);

  // Tab 5: Bulletins & Passes state
  const [hubBulletinReports, setHubBulletinReports] = useState<
    HubBulletinReportRow[]
  >([]);
  const [hubBulletinPasses, setHubBulletinPasses] = useState<
    HubBulletinPassRow[]
  >([]);
  const [hubSubscriptions, setHubSubscriptions] = useState<
    HubSubscriptionRow[]
  >([]);
  const [busyBulletinItemId, setBusyBulletinItemId] = useState<string | null>(
    null
  );

  // Tab 6: Hub Payments state
  const [hubPaymentIntents, setHubPaymentIntents] = useState<
    HubPaymentIntentRow[]
  >([]);
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<string>('all');
  const [busyIntentId, setBusyIntentId] = useState<string | null>(null);

  // Print & Digital Hub KPI metadata count (ZERO print_order_files access)
  const [hubActivePrintOrdersCount, setHubActivePrintOrdersCount] =
    useState<number>(0);
  // Pending Civic Correction Reports count for this hub
  const [hubPendingCivicReportsCount, setHubPendingCivicReportsCount] =
    useState<number>(0);
  // Pending Partner Applications & Referrals counts for this hub
  const [hubPendingApplicationsCount, setHubPendingApplicationsCount] =
    useState<number>(0);
  const [hubPendingReferralsCount, setHubPendingReferralsCount] =
    useState<number>(0);

  // v21b P1-08: Hub-scoped Suggested Categories Triage, Vehicle Listings & Audit Logs
  const [hubSuggestedCategories, setHubSuggestedCategories] = useState<
    Array<{
      id: string;
      display_name: string;
      root_key?: string | null;
      review_status: string;
      hub_triage_status?: string | null;
      suggested_hub_id?: string | null;
      created_at?: string | null;
    }>
  >([]);
  const [busyCategoryTriageId, setBusyCategoryTriageId] = useState<
    string | null
  >(null);
  const [hubVehicleListings, setHubVehicleListings] = useState<
    Array<{
      id: string;
      title: string;
      stand_locality?: string | null;
      total_seats?: number | null;
      is_active: boolean;
      is_verified?: boolean | null;
    }>
  >([]);
  const [hubAuditLogs, setHubAuditLogs] = useState<
    Array<{
      id: string;
      timestamp?: string | null;
      actor_name?: string | null;
      actor_role?: string | null;
      workspace?: string | null;
      action: string;
      target_name?: string | null;
      details?: string | null;
    }>
  >([]);

  const showNotice = useCallback(
    (type: 'success' | 'error' | 'info', text: string) => {
      setBannerNotice({ type, text });
    },
    []
  );

  // Load Hub-Scoped Data from Supabase whenever selectedHub.id changes
  const loadHubWorkspaceData = useCallback(async () => {
    const hubId = activeSelectedHubId;
    if (!hubId || !isSupabaseConfigured()) {
      return;
    }

    setIsLoadingData(true);
    try {
      const [
        listingsRes,
        productsRes,
        localitiesRes,
        driversRes,
        vehiclesRes,
        ordersRes,
        bookingsRes,
        bulletinsRes,
        passesRes,
        subsRes,
        intentsRes,
        activePrintCountRes,
        pendingCivicReportsRes,
        suggestedCatsRes,
        vehicleListingsRes,
        auditLogsRes,
      ] = await Promise.all([
        Promise.resolve(
          supabase
            .from('listings')
            .select(
              'id, hub_id, title, category, subcategory, locality, status, owner_name, contact_phone, created_at'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(100)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('marketplace_products')
            .select(
              'id, hub_id, title, category, price_inr, stock_status, is_active, seller_name, seller_phone, created_at'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(100)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('hub_localities')
            .select(
              'id, hub_id, slug, display_name, aliases, lat, lng, source, status, merged_into_id, usage_count, created_at'
            )
            .eq('hub_id', hubId)
            .order('usage_count', { ascending: false })
            .order('display_name', { ascending: true })
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('drivers')
            .select(
              // v21a (P0-05): canonical drivers columns aliased to the UI field names
              'id, hub_id, profile_id, full_name, phone, license_number:license_no, kyc_verified, is_available:is_online'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('vehicles')
            .select(
              // v21a (P0-05): `vehicles` has is_available (no is_active column)
              'id, hub_id, driver_id, vehicle_type_id, plate_number, model_name, rc_number, is_active:is_available'
            )
            .eq('hub_id', hubId)
            .order('updated_at', { ascending: false }) // v21a: vehicles has no created_at
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('delivery_orders')
            .select(
              // v21a (P0-05): canonical delivery_orders columns (no final_fare_inr / upi_utr_ref)
              'id, order_code, hub_id, service_mode, status, pickup_address, drop_address:dropoff_address, item_category:container_type, quoted_fare_inr, driver_id, vehicle_id, pod_storage_path, created_at'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(80)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('vehicle_bookings')
            .select(
              // v21a (P0-05): canonical vehicle_bookings columns (hub_id is stamped server-side)
              'id, booking_code, hub_id, vehicle_listing_id, booking_type:booking_mode, seats_booked, trip_date:start_time, pickup_address:pickup_location, drop_address:dropoff_location, total_fare_inr, advance_paid_inr:advance_amount_inr, balance_due_inr, status, escrow_status, created_at'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(80)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('bulletins')
            .select('id, title, category, status, hub_id')
            .eq('hub_id', hubId)
            .limit(200)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('bulletin_post_passes')
            .select(
              // v21a (P0-05): bulletin_post_passes stores `price_inr`
              'id, user_id, amount_inr:price_inr, duration_days, upi_utr_ref, status, created_at'
            )
            .order('created_at', { ascending: false })
            .limit(40)
        ).catch(() => ({ data: [], error: null })),
        // v21a (P0-05): user_subscriptions has no hub_id — the former unscoped query leaked
        // every hub's subscribers to any hub manager. Subscription governance stays Superadmin-only.
        Promise.resolve({ data: [] as unknown[], error: null }),
        Promise.resolve(
          supabase
            .from('payment_intents')
            .select(
              'id, intent_code, user_id, hub_id, purpose, reference_id, amount_inr, base_amount_inr, discount_inr, convenience_fee_inr, provider, upi_utr_ref, status, created_at'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(100)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('print_orders')
            .select('id', { count: 'exact', head: true })
            .eq('hub_id', hubId)
            .in('fulfillment_status', [
              'confirmed',
              'printing',
              'ready_for_pickup',
            ])
        ).catch(() => ({ count: 0, error: null })),
        Promise.resolve(
          supabase
            .from('civic_correction_reports')
            .select('id', { count: 'exact', head: true })
            .eq('hub_id', hubId)
            .eq('status', 'pending')
        ).catch(() => ({ count: 0, error: null })),
        Promise.resolve(
          supabase
            .from('categories')
            .select(
              'id, display_name, root_key, review_status, hub_triage_status, suggested_hub_id, created_at'
            )
            .eq('review_status', 'pending_review')
            .or(`suggested_hub_id.eq.${hubId},suggested_hub_id.is.null`)
            .order('created_at', { ascending: false })
            .limit(40)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('vehicle_listings')
            .select('id, title, stand_locality, total_seats, is_active, is_verified')
            .eq('origin_hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(50)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('audit_logs')
            .select(
              'id, timestamp, actor_name, actor_role, workspace, action, target_name, details'
            )
            .eq('hub_id', hubId)
            .order('timestamp', { ascending: false })
            .limit(50)
        ).catch(() => ({ data: [], error: null })),
      ]);

      setHubListings(
        Array.isArray(listingsRes.data)
          ? (listingsRes.data as HubListingRow[])
          : []
      );
      setHubProducts(
        Array.isArray(productsRes.data)
          ? (productsRes.data as HubProductRow[])
          : []
      );
      setHubLocalitiesList(
        Array.isArray(localitiesRes.data)
          ? (localitiesRes.data as HubLocalityRow[]).map((loc) => ({
              ...loc,
              aliases: Array.isArray(loc.aliases) ? loc.aliases : [],
              usage_count: Number(loc.usage_count) || 0,
            }))
          : []
      );
      setHubDrivers(
        Array.isArray(driversRes.data)
          ? (driversRes.data as HubDriverRow[])
          : []
      );
      setHubVehicles(
        Array.isArray(vehiclesRes.data)
          ? (vehiclesRes.data as HubVehicleRow[])
          : []
      );
      setHubOrders(
        Array.isArray(ordersRes.data)
          ? (ordersRes.data as HubDeliveryOrderRow[])
          : []
      );
      setHubBookings(
        Array.isArray(bookingsRes.data)
          ? (bookingsRes.data as HubVehicleBookingRow[])
          : []
      );

      // Resolve bulletin_reports affecting bulletins in this hub
      const hubBulletinsList = Array.isArray(bulletinsRes.data)
        ? (bulletinsRes.data as Array<{
            id: string;
            title?: string;
            category?: string;
            status?: string;
          }>)
        : [];
      const bulletinById = new Map(hubBulletinsList.map((b) => [b.id, b]));
      const hubBulletinIds = Array.from(bulletinById.keys());

      if (hubBulletinIds.length > 0) {
        const reportsRes = await Promise.resolve(
          supabase
            .from('bulletin_reports')
            .select(
              'id, bulletin_id, reporter_id, reason, details, status, created_at'
            )
            .in('bulletin_id', hubBulletinIds)
            .order('created_at', { ascending: false })
        ).catch(() => ({ data: [], error: null }));

        const enrichedReports: HubBulletinReportRow[] = Array.isArray(
          reportsRes.data
        )
          ? (reportsRes.data as HubBulletinReportRow[]).map((rep) => {
              const parent = bulletinById.get(rep.bulletin_id);
              return {
                ...rep,
                bulletin_title: parent?.title || 'Hub Bulletin Post',
                bulletin_category: parent?.category || 'notice',
                bulletin_status: parent?.status || 'published',
              };
            })
          : [];
        setHubBulletinReports(enrichedReports);
      } else {
        setHubBulletinReports([]);
      }

      const hubIntents = Array.isArray(intentsRes.data)
        ? (intentsRes.data as HubPaymentIntentRow[])
        : [];
      setHubPaymentIntents(hubIntents);
      setHubActivePrintOrdersCount(
        Number((activePrintCountRes as { count?: number | null })?.count || 0)
      );
      setHubPendingCivicReportsCount(
        Number(
          (pendingCivicReportsRes as { count?: number | null })?.count || 0
        )
      );

      // Filter passes & subscriptions to users or payment intents belonging to this hub
      const hubIntentRefIds = new Set(
        hubIntents.map((pi) => pi.reference_id).filter(Boolean)
      );
      const hubIntentUserIds = new Set(
        hubIntents.map((pi) => pi.user_id).filter(Boolean)
      );

      const allPasses = Array.isArray(passesRes.data)
        ? (passesRes.data as HubBulletinPassRow[])
        : [];
      setHubBulletinPasses(
        allPasses.filter(
          (p) =>
            hubIntentRefIds.has(p.id) ||
            hubIntentUserIds.has(p.user_id) ||
            hubIntents.length === 0
        )
      );

      const allSubs = Array.isArray(subsRes.data)
        ? (subsRes.data as HubSubscriptionRow[])
        : [];
      setHubSubscriptions(
        allSubs.filter(
          (s) =>
            hubIntentRefIds.has(s.id) ||
            hubIntentUserIds.has(s.user_id) ||
            hubIntents.length === 0
        )
      );
      setHubSuggestedCategories(
        Array.isArray((suggestedCatsRes as { data?: unknown[] })?.data)
          ? ((suggestedCatsRes as { data: unknown[] }).data as typeof hubSuggestedCategories)
          : []
      );
      setHubVehicleListings(
        Array.isArray((vehicleListingsRes as { data?: unknown[] })?.data)
          ? ((vehicleListingsRes as { data: unknown[] }).data as typeof hubVehicleListings)
          : []
      );
      setHubAuditLogs(
        Array.isArray((auditLogsRes as { data?: unknown[] })?.data)
          ? ((auditLogsRes as { data: unknown[] }).data as typeof hubAuditLogs)
          : []
      );
    } finally {
      setIsLoadingData(false);
    }
  }, [activeSelectedHubId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadHubWorkspaceData();
    });
  }, [loadHubWorkspaceData]);

  // Switch active branch hub in Hub Manager Workspace
  const handleSelectBranchHub = (hub: ServiceHubRecord) => {
    setSelectedHubId(hub.id);
    void switchHub(hub.slug);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('psl_preview_hub_slug', hub.slug);
      } catch {
        // ignore storage errors
      }
    }
    showNotice('info', `Switched Hub Manager workspace to ${hub.name} (${hub.state}).`);
  };

  // ===========================================================================
  // TAB 1 ACTIONS: Save Hub Module Switches & Local Branch Contact
  // ===========================================================================
  const handleSaveHubModuleSwitches = async () => {
    if (!selectedHub?.id) return;
    const pausedModules = Object.entries(moduleSwitchesDraft)
      .filter(([, entry]) => entry && entry.enabled === false)
      .map(([k]) => k.replace(/_/g, ' '));
    const confirmed = await confirmDangerAction({
      title:
        pausedModules.length > 0
          ? `Pause ${pausedModules.length} module(s) in ${selectedHub.name}?`
          : `Apply live module switch changes for ${selectedHub.name}?`,
      description:
        pausedModules.length > 0
          ? `Customers in ${selectedHub.name} will immediately see a paused notice for: ${pausedModules.join(', ')}. Existing in-flight orders remain fulfillable.`
          : `All modules in ${selectedHub.name} will be live for customers immediately.`,
      confirmLabel:
        pausedModules.length > 0 ? 'Confirm & Pause Modules' : 'Apply Switches',
      cancelLabel: 'Cancel',
      variant: pausedModules.length > 0 ? 'danger' : 'default',
    });
    if (!confirmed) return;
    setIsSavingSwitches(true);
    setStatus('saving', `Updating ${selectedHub.name} module switches...`);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('service_hubs')
          .update({
            module_switches: moduleSwitchesDraft,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      await refreshConfig(true, selectedHub.slug);
      setStatus('success');
      showNotice(
        'success',
        `Saved local module switches for ${selectedHub.name}.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to update hub module switches.'
      );
    } finally {
      setIsSavingSwitches(false);
    }
  };

  const handleSaveHubOfficeContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHub?.id) return;
    setIsSavingContact(true);
    setStatus('saving');
    try {
      const cleanedContact: Partial<OfficeAndContactConfig> = {
        address: (officeContactDraft.address || '').trim(),
        phone: (officeContactDraft.phone || '').trim(),
        whatsapp: (officeContactDraft.whatsapp || '').trim(),
        email: (officeContactDraft.email || '').trim(),
        operating_hours: (officeContactDraft.operating_hours || '').trim(),
      };
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('service_hubs')
          .update({
            office_contact: cleanedContact,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      await refreshConfig(true, selectedHub.slug);
      setStatus('success');
      showNotice(
        'success',
        `Updated local branch contact details for ${selectedHub.name}.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to update branch office contact.'
      );
    } finally {
      setIsSavingContact(false);
    }
  };

  // ===========================================================================
  // TAB 2 ACTIONS: Moderate Hub Listings & Marketplace Products
  // ===========================================================================
  const handleUpdateListingStatus = async (
    listingId: string,
    nextStatus: 'published' | 'draft' | 'archived'
  ) => {
    if (!selectedHub?.id) return;
    const isReviewDecision =
      nextStatus === 'published' || nextStatus === 'archived';
    if (isReviewDecision) {
      const confirmed = await confirmDangerAction({
        title:
          nextStatus === 'published'
            ? 'Approve & Publish Listing?'
            : 'Reject Listing & Purge Unapproved Media?',
        description:
          nextStatus === 'published'
            ? 'Approving sets this listing verified & live on Explore and promotes temporary pending media into permanent storage.'
            : 'Rejecting hard-deletes unapproved uploaded files from Supabase Storage & media_assets, scrubs pending URLs, and notifies the owner.',
        confirmLabel:
          nextStatus === 'published'
            ? 'Approve & Publish'
            : 'Reject & Purge Media',
        variant: nextStatus === 'archived' ? 'danger' : 'default',
      });
      if (!confirmed) return;
    }

    setBusyCatalogId(listingId);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        if (isReviewDecision) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`;
          }
          const reviewAction =
            nextStatus === 'published' ? 'approve' : 'reject';
          const res = await fetch('/api/listings/review', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              listingId,
              action: reviewAction,
              reviewerNotes:
                reviewAction === 'reject'
                  ? 'Rejected by Hub Manager during moderation review.'
                  : undefined,
            }),
          });
          const payload = (await res.json().catch(() => null)) as {
            ok?: boolean;
            error?: string;
            deletedFilesCount?: number;
          } | null;
          if (!res.ok || !payload?.ok) {
            throw new Error(
              payload?.error || 'Failed to execute listing review.'
            );
          }
        } else {
          const { error } = await supabase
            .from('listings')
            .update({
              status: nextStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', listingId)
            .eq('hub_id', selectedHub.id);
          if (error) throw new Error(error.message);
        }
      }
      const resultingStatus =
        nextStatus === 'published' ? 'published' : 'draft';
      setHubListings((prev) =>
        prev.map((item) =>
          item.id === listingId ? { ...item, status: resultingStatus } : item
        )
      );
      setStatus('success');
      showNotice(
        'success',
        nextStatus === 'published'
          ? 'Listing approved, verified, and media promoted to permanent storage.'
          : nextStatus === 'archived'
          ? 'Listing rejected, unapproved media purged, and owner notified.'
          : 'Listing moved back to draft.'
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update listing status.'
      );
    } finally {
      setBusyCatalogId(null);
    }
  };

  const handleToggleProductActive = async (
    productId: string,
    nextActive: boolean
  ) => {
    if (!selectedHub?.id) return;
    setBusyCatalogId(productId);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('marketplace_products')
          .update({
            is_active: nextActive,
            updated_at: new Date().toISOString(),
          })
          .eq('id', productId)
          .eq('hub_id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      setHubProducts((prev) =>
        prev.map((prod) =>
          prod.id === productId ? { ...prod, is_active: nextActive } : prod
        )
      );
      setStatus('success');
      showNotice(
        'success',
        nextActive
          ? 'Marketplace product approved and live in hub.'
          : 'Marketplace product paused in hub.'
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update product status.'
      );
    } finally {
      setBusyCatalogId(null);
    }
  };

  // ===========================================================================
  // TAB 3 ACTIONS: Locality Pool (Verify, Rename, Merge into Canonical, Add)
  // ===========================================================================
  const handleVerifyLocality = async (loc: HubLocalityRow) => {
    if (!selectedHub?.id) return;
    setBusyLocalityId(loc.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('hub_localities')
          .update({
            status: 'verified',
            source: 'admin',
            updated_at: new Date().toISOString(),
          })
          .eq('id', loc.id)
          .eq('hub_id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      setHubLocalitiesList((prev) =>
        prev.map((item) =>
          item.id === loc.id
            ? { ...item, status: 'verified', source: 'admin' }
            : item
        )
      );
      await refreshConfig(true, selectedHub.slug);
      setStatus('success');
      showNotice(
        'success',
        `Verified "${loc.display_name}" in ${selectedHub.name} locality pool.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to verify locality.'
      );
    } finally {
      setBusyLocalityId(null);
    }
  };

  const handleRenameLocality = async (loc: HubLocalityRow) => {
    const cleanName = editingLocalityName.trim();
    if (!cleanName || !selectedHub?.id) return;
    setBusyLocalityId(loc.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('hub_localities')
          .update({
            display_name: cleanName,
            updated_at: new Date().toISOString(),
          })
          .eq('id', loc.id)
          .eq('hub_id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      setHubLocalitiesList((prev) =>
        prev.map((item) =>
          item.id === loc.id ? { ...item, display_name: cleanName } : item
        )
      );
      setEditingLocalityId(null);
      setEditingLocalityName('');
      await refreshConfig(true, selectedHub.slug);
      setStatus('success');
      showNotice('success', `Renamed locality to "${cleanName}".`);
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to rename locality.'
      );
    } finally {
      setBusyLocalityId(null);
    }
  };

  const handleMergeLocalityIntoCanonical = async (
    sourceLoc: HubLocalityRow,
    targetCanonicalId: string
  ) => {
    if (!targetCanonicalId || targetCanonicalId === sourceLoc.id) return;
    const targetLoc = hubLocalitiesList.find((l) => l.id === targetCanonicalId);
    if (!targetLoc) return;

    setBusyLocalityId(sourceLoc.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase.rpc('merge_locality_into_canonical', {
          p_source_id: sourceLoc.id,
          p_target_id: targetCanonicalId,
        });
        if (error) throw new Error(error.message);
      }

      setHubLocalitiesList((prev) =>
        prev.map((item) => {
          if (item.id === sourceLoc.id) {
            return {
              ...item,
              status: 'merged',
              merged_into_id: targetCanonicalId,
            };
          }
          if (item.id === targetCanonicalId) {
            const combinedAliases = Array.from(
              new Set([
                ...(item.aliases || []),
                sourceLoc.display_name,
                ...(sourceLoc.aliases || []),
              ])
            ).filter(
              (a) =>
                a.trim().toLowerCase() !==
                item.display_name.trim().toLowerCase()
            );
            return {
              ...item,
              status: 'verified',
              aliases: combinedAliases,
              usage_count:
                (item.usage_count || 0) + (sourceLoc.usage_count || 0),
            };
          }
          return item;
        })
      );
      await refreshConfig(true, selectedHub.slug);
      setStatus('success');
      showNotice(
        'success',
        `Merged "${sourceLoc.display_name}" into canonical locality "${targetLoc.display_name}" and preserved aliases.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to merge locality into canonical.'
      );
    } finally {
      setBusyLocalityId(null);
    }
  };

  const handleAddVerifiedLocality = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newLocalityName.trim();
    if (!cleanName || !selectedHub?.id) return;
    setIsAddingLocality(true);
    setStatus('saving');
    try {
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const aliases = newLocalityAliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (isSupabaseConfigured()) {
        const { data, error } = await supabase
          .from('hub_localities')
          .insert({
            hub_id: selectedHub.id,
            slug: slug || `loc_${Date.now()}`,
            display_name: cleanName,
            aliases,
            lat: selectedHub.center_lat,
            lng: selectedHub.center_lng,
            source: 'admin',
            status: 'verified',
            usage_count: 0,
            submitted_by: authUser?.id || null,
          })
          .select('*')
          .maybeSingle();

        if (error) throw new Error(error.message);
        if (data) {
          setHubLocalitiesList((prev) => [data as HubLocalityRow, ...prev]);
        }
      }
      setNewLocalityName('');
      setNewLocalityAliases('');
      await refreshConfig(true, selectedHub.slug);
      setStatus('success');
      showNotice(
        'success',
        `Added verified locality "${cleanName}" to ${selectedHub.name}.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to add locality.'
      );
    } finally {
      setIsAddingLocality(false);
    }
  };

  // ===========================================================================
  // TAB 4 ACTIONS: Pick N Drop & Fleet (Drivers, Vehicles, Orders, Bookings)
  // ===========================================================================
  const handleToggleDriverKyc = async (driver: HubDriverRow) => {
    if (!selectedHub?.id) return;
    const nextKyc = !driver.kyc_verified;
    setBusyFleetItemId(driver.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('drivers')
          .update({ kyc_verified: nextKyc })
          .eq('id', driver.id)
          .eq('hub_id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      setHubDrivers((prev) =>
        prev.map((d) =>
          d.id === driver.id ? { ...d, kyc_verified: nextKyc } : d
        )
      );
      setStatus('success');
      showNotice(
        'success',
        nextKyc
          ? `Approved driver KYC for ${driver.full_name}.`
          : `Revoked driver KYC for ${driver.full_name}.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update driver KYC.'
      );
    } finally {
      setBusyFleetItemId(null);
    }
  };

  const handleToggleVehicleActive = async (vehicle: HubVehicleRow) => {
    if (!selectedHub?.id) return;
    const nextActive = !vehicle.is_active;
    setBusyFleetItemId(vehicle.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('vehicles')
          .update({ is_available: nextActive })
          .eq('id', vehicle.id)
          .eq('hub_id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      setHubVehicles((prev) =>
        prev.map((v) =>
          v.id === vehicle.id ? { ...v, is_active: nextActive } : v
        )
      );
      setStatus('success');
      showNotice(
        'success',
        nextActive
          ? `Activated fleet vehicle ${vehicle.plate_number}.`
          : `Suspended fleet vehicle ${vehicle.plate_number}.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update fleet vehicle.'
      );
    } finally {
      setBusyFleetItemId(null);
    }
  };

  const handleAssignOrderDriverAndStage = async (
    order: HubDeliveryOrderRow,
    nextStatus: string
  ) => {
    if (!selectedHub?.id) return;
    const chosenDriverId =
      assignDriverByOrder[order.id] ?? order.driver_id ?? null;
    const chosenVehicleId =
      assignVehicleByOrder[order.id] ?? order.vehicle_id ?? null;

    setBusyFleetItemId(order.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('delivery_orders')
          .update({
            status: nextStatus,
            driver_id: chosenDriverId || null,
            vehicle_id: chosenVehicleId || null,
            mediator_id: authUser?.id || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id)
          .eq('hub_id', selectedHub.id);
        if (error) throw new Error(error.message);
      }
      setHubOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                status: nextStatus,
                driver_id: chosenDriverId || null,
                vehicle_id: chosenVehicleId || null,
              }
            : o
        )
      );
      setStatus('success');
      showNotice(
        'success',
        `Order ${order.order_code || order.id.slice(0, 8)} updated to "${nextStatus}".`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update delivery order.'
      );
    } finally {
      setBusyFleetItemId(null);
    }
  };

  const handleOpenSignedPod = async (order: HubDeliveryOrderRow) => {
    if (!order.pod_storage_path) return;
    setBusyFleetItemId(order.id);
    try {
      const signed = await getSignedPodUrl(order.pod_storage_path, 300);
      if (signed) {
        setSignedPodUrlByOrder((prev) => ({ ...prev, [order.id]: signed }));
        showNotice(
          'info',
          'Generated 5-minute signed Proof-of-Delivery preview.'
        );
      } else {
        showNotice('error', 'Unable to generate signed POD link.');
      }
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to load POD preview.'
      );
    } finally {
      setBusyFleetItemId(null);
    }
  };

  // v21a (P0-05): no direct vehicle_bookings writes — escrow/audit-safe mediator RPCs only
  const handleUpdateBookingStatus = async (
    booking: HubVehicleBookingRow,
    action: 'verify_upi' | 'release_payout'
  ) => {
    setBusyFleetItemId(booking.id);
    setStatus('saving');
    try {
      let nextStatus = booking.status;
      let nextEscrow = booking.escrow_status ?? null;
      if (isSupabaseConfigured()) {
        const { data, error } =
          action === 'verify_upi'
            ? await supabase.rpc('mediator_verify_upi_payment', {
                p_booking_id: booking.id,
                p_decision: 'verify',
                p_notes: 'Verified from Hub Manager fleet desk',
              })
            : await supabase.rpc('mediator_resolve_escrow_payout', {
                p_booking_id: booking.id,
                p_action: 'release_to_driver',
                p_reason: null,
              });
        if (error) throw new Error(error.message);
        const result = (data || {}) as { status?: string; escrow_status?: string };
        nextStatus = result.status || nextStatus;
        nextEscrow = result.escrow_status || nextEscrow;
      }
      setHubBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id
            ? { ...b, status: nextStatus, escrow_status: nextEscrow }
            : b
        )
      );
      setStatus('success');
      showNotice(
        'success',
        action === 'verify_upi'
          ? `UPI payment verified for ${booking.booking_code}.`
          : `Escrow payout released for ${booking.booking_code}.`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update vehicle booking.'
      );
    } finally {
      setBusyFleetItemId(null);
    }
  };

  // ===========================================================================
  // TAB 5 ACTIONS: Bulletins & Passes Moderation
  // ===========================================================================
  const handleResolveBulletinReport = async (
    report: HubBulletinReportRow,
    action: 'dismiss' | 'remove_bulletin'
  ) => {
    setBusyBulletinItemId(report.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        if (action === 'remove_bulletin') {
          const { error: modErr } = await supabase.rpc(
            'hub_manager_moderate_bulletin',
            {
              p_bulletin_id: report.bulletin_id,
              p_status: 'rejected',
              p_notes: `Removed from hub report queue (${report.reason})`,
            }
          );
          if (modErr) throw new Error(modErr.message);
        }
        const { error } = await supabase
          .from('bulletin_reports')
          .update({
            status: action === 'remove_bulletin' ? 'resolved' : 'dismissed',
          })
          .eq('id', report.id);
        if (error) throw new Error(error.message);
      }
      setHubBulletinReports((prev) =>
        prev.map((r) =>
          r.id === report.id
            ? {
                ...r,
                status: action === 'remove_bulletin' ? 'resolved' : 'dismissed',
                bulletin_status:
                  action === 'remove_bulletin'
                    ? 'rejected'
                    : r.bulletin_status,
              }
            : r
        )
      );
      setStatus('success');
      showNotice(
        'success',
        action === 'remove_bulletin'
          ? 'Bulletin removed and report marked resolved.'
          : 'Bulletin report dismissed.'
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to resolve bulletin report.'
      );
    } finally {
      setBusyBulletinItemId(null);
    }
  };

  // v21b P1-08: Hub Manager Suggested Category Triage & Vehicle Listing Verification
  const handleTriageSuggestedCategory = async (
    categoryId: string,
    displayName: string,
    recommendation: 'recommend_approve' | 'recommend_merge' | 'recommend_reject'
  ) => {
    if (!selectedHub?.id || !isSupabaseConfigured()) return;
    setBusyCategoryTriageId(categoryId);
    setStatus('saving');
    try {
      const { error } = await supabase.rpc('hub_triage_suggested_category', {
        p_category_id: categoryId,
        p_hub_id: selectedHub.id,
        p_recommendation: recommendation,
        p_notes: `Triaged by Hub Manager for ${selectedHub.name}`,
      });
      if (error) throw new Error(error.message);
      setHubSuggestedCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, hub_triage_status: recommendation } : c
        )
      );
      setStatus('success');
      showNotice(
        'success',
        `Recorded "${recommendation.replace(/_/g, ' ')}" recommendation for "${displayName}".`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to triage suggested category.'
      );
    } finally {
      setBusyCategoryTriageId(null);
    }
  };

  const handleVerifyVehicleListing = async (
    listingId: string,
    title: string,
    nextActive: boolean
  ) => {
    if (!isSupabaseConfigured()) return;
    setBusyFleetItemId(listingId);
    setStatus('saving');
    try {
      const { error } = await supabase.rpc(
        'hub_manager_verify_vehicle_listing',
        {
          p_vehicle_listing_id: listingId,
          p_is_active: nextActive,
          p_notes: nextActive
            ? `Verified & activated for ${selectedHub?.name || 'hub'}`
            : `Paused by Hub Manager (${selectedHub?.name || 'hub'})`,
        }
      );
      if (error) throw new Error(error.message);
      setHubVehicleListings((prev) =>
        prev.map((vl) =>
          vl.id === listingId
            ? { ...vl, is_active: nextActive, is_verified: nextActive }
            : vl
        )
      );
      setStatus('success');
      showNotice(
        'success',
        nextActive
          ? `Verified & activated scheduled vehicle "${title}".`
          : `Paused scheduled vehicle "${title}".`
      );
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to verify vehicle listing.'
      );
    } finally {
      setBusyFleetItemId(null);
    }
  };

  // ===========================================================================
  // TAB 6 ACTIONS: Hub Payments (Delegated Manual UPI Approval)
  // ===========================================================================
  const handleFulfillHubPaymentIntent = async (
    intent: HubPaymentIntentRow
  ) => {
    if (!canExecuteManualPaymentFulfillment) {
      showNotice(
        'info',
        'Manual UPI confirmation is centrally handled by Super-Admin for this hub.'
      );
      return;
    }

    setBusyIntentId(intent.id);
    setStatus('saving');
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase.rpc('fulfill_payment_intent', {
          p_intent_id: intent.id,
          p_provider_payment_id: intent.upi_utr_ref || null,
          p_provider: intent.provider || 'manual_upi',
        });
        if (error) throw new Error(error.message);
      }
      setHubPaymentIntents((prev) =>
        prev.map((pi) =>
          pi.id === intent.id ? { ...pi, status: 'succeeded' } : pi
        )
      );
      setStatus('success');
      showNotice(
        'success',
        `Approved and fulfilled payment intent ${intent.intent_code} (₹${intent.amount_inr}).`
      );
      void loadHubWorkspaceData();
    } catch (err) {
      setStatus('error');
      showNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to fulfill payment intent.'
      );
    } finally {
      setBusyIntentId(null);
    }
  };

  // ===========================================================================
  // COMPUTED METRICS & FILTERED LISTS
  // ===========================================================================
  const pendingLocalitiesCount = useMemo(
    () => hubLocalitiesList.filter((l) => l.status === 'pending').length,
    [hubLocalitiesList]
  );

  const verifiedLocalitiesOptions = useMemo<CustomSelectOption[]>(
    () =>
      hubLocalitiesList
        .filter((l) => l.status === 'verified')
        .map((l) => ({
          value: l.id,
          label: `${l.display_name} (${l.usage_count || 0} uses)`,
          description:
            l.aliases && l.aliases.length > 0
              ? `Aliases: ${l.aliases.join(', ')}`
              : `Slug: ${l.slug}`,
        })),
    [hubLocalitiesList]
  );

  const activeOrdersCount = useMemo(
    () =>
      hubOrders.filter(
        (o) => !['completed', 'cancelled', 'refunded'].includes(o.status)
      ).length,
    [hubOrders]
  );

  const filteredListings = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return hubListings.filter((item) => {
      if (catalogStatusFilter !== 'all' && item.status !== catalogStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.locality || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q)
      );
    });
  }, [hubListings, catalogStatusFilter, catalogSearch]);

  const filteredProducts = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return hubProducts.filter((prod) => {
      if (catalogStatusFilter === 'published' && !prod.is_active) return false;
      if (catalogStatusFilter === 'draft' && prod.is_active) return false;
      if (!q) return true;
      return (
        prod.title.toLowerCase().includes(q) ||
        (prod.category || '').toLowerCase().includes(q) ||
        (prod.seller_name || '').toLowerCase().includes(q)
      );
    });
  }, [hubProducts, catalogStatusFilter, catalogSearch]);

  const filteredLocalities = useMemo(() => {
    const q = localitySearch.trim().toLowerCase();
    return hubLocalitiesList.filter((loc) => {
      if (
        localityStatusFilter !== 'all' &&
        loc.status !== localityStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      const inAliases = (loc.aliases || []).some((a) =>
        a.toLowerCase().includes(q)
      );
      return (
        loc.display_name.toLowerCase().includes(q) ||
        loc.slug.toLowerCase().includes(q) ||
        inAliases
      );
    });
  }, [hubLocalitiesList, localityStatusFilter, localitySearch]);

  const filteredPaymentIntents = useMemo(() => {
    return hubPaymentIntents.filter((pi) => {
      if (paymentStatusFilter === 'all') return true;
      if (paymentStatusFilter === 'pending') {
        return (
          pi.status === 'pending_manual' || pi.status === 'awaiting_payment'
        );
      }
      return pi.status === paymentStatusFilter;
    });
  }, [hubPaymentIntents, paymentStatusFilter]);

  const driverSelectOptions = useMemo<CustomSelectOption[]>(
    () => [
      { value: '', label: 'Unassigned Driver' },
      ...hubDrivers.map((d) => ({
        value: d.id,
        label: `${d.full_name} (${d.phone})`,
        description: `${d.kyc_verified ? 'KYC Verified' : 'KYC Pending'} • ${
          d.is_available ? 'Online' : 'Offline'
        }`,
      })),
    ],
    [hubDrivers]
  );

  const vehicleSelectOptions = useMemo<CustomSelectOption[]>(
    () => [
      { value: '', label: 'Unassigned Vehicle' },
      ...hubVehicles.map((v) => ({
        value: v.id,
        label: `${v.plate_number} ${v.model_name ? `• ${v.model_name}` : ''}`,
        description: v.is_active ? 'Active Fleet' : 'Suspended',
      })),
    ],
    [hubVehicles]
  );

  const tabs: Array<{
    id: HubWorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'overview',
      label: 'Overview & Switches',
      icon: Building2,
    },
    {
      id: 'listings',
      label: 'Listings & Products',
      icon: Store,
      badge: hubListings.length + hubProducts.length,
    },
    {
      id: 'shops_food',
      label: 'Shops & Food',
      icon: ShoppingBag,
    },
    {
      id: 'real_estate',
      label: 'Real Estate',
      icon: Home,
    },
    {
      id: 'bookings_stays',
      label: 'Bookings & Stays',
      icon: Calendar,
    },
    {
      id: 'print_digital',
      label: 'Print & Digital',
      icon: Printer,
      badge: hubActivePrintOrdersCount,
    },
    {
      id: 'public_civic',
      label: 'Public & Civic',
      icon: Landmark,
      badge: hubPendingCivicReportsCount,
    },
    {
      id: 'localities',
      label: 'Locality Pool',
      icon: MapPin,
      badge: pendingLocalitiesCount,
    },
    {
      id: 'fleet',
      label: 'Pick N Drop & Fleet',
      icon: Truck,
      badge: activeOrdersCount + hubBookings.length,
    },
    {
      id: 'bulletins',
      label: 'Bulletins & Passes',
      icon: Megaphone,
      badge: hubBulletinReports.filter((r) => r.status === 'pending').length,
    },
    {
      id: 'payments',
      label: 'Hub Payments',
      icon: CreditCard,
      badge: hubPaymentIntents.filter(
        (p) => p.status === 'pending_manual'
      ).length,
    },
    {
      id: 'applications',
      label: 'Partner Apps',
      icon: UserCheck,
      badge: hubPendingApplicationsCount,
    },
    {
      id: 'referrals',
      label: 'Referrals',
      icon: Gift,
      badge: hubPendingReferralsCount,
    },
    {
      id: 'featured',
      label: 'Featured Slots',
      icon: Sparkles,
      badge: 0,
    },
    {
      id: 'audit_logs',
      label: 'Hub Audit Trail',
      icon: FileText,
      badge: hubAuditLogs.length,
    },
  ];

  return (
    <div
      data-testid="hub-manager-workspace"
      data-selected-hub-slug={selectedHub?.slug || 'churachandpur'}
      className="w-full min-w-0 max-w-full overflow-x-clip space-y-4 text-[var(--ps-text)]"
    >
      {/* Top Header & Multi-Hub Branch Switcher Pill Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-theme-primary text-theme-primary-foreground shadow-xs">
              <Building2 className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="text-base sm:text-xl font-bold leading-snug tracking-tight text-[var(--ps-text)] break-words">
                  {selectedHub?.name || 'Churachandpur'} Hub Manager Console
                </h1>
                <span className="inline-flex items-center gap-1 rounded-md bg-theme-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-theme-primary">
                  <MapPin className="h-2.5 w-2.5" />
                  {selectedHub?.state || 'Manipur'}
                </span>
                {isPreviewMode && (
                  <span
                    data-testid="hub-manager-preview-badge"
                    className="inline-flex items-center gap-1 rounded-md bg-purple-600/15 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300"
                  >
                    <Eye className="h-2.5 w-2.5" />
                    Super-Admin Preview
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--ps-text-muted)] mt-0.5 line-clamp-2 sm:line-clamp-none">
                Scoped regional branch operations, veng locality pool verification,
                fleet dispatch, and hub governance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadHubWorkspaceData()}
              disabled={isLoadingData}
              data-testid="hub-manager-refresh-btn"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoadingData ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <Link
              href={`/explore?hub=${selectedHub?.slug || 'churachandpur'}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 transition-opacity"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>View Hub Map</span>
            </Link>
          </div>
        </div>

        {/* Sleek Hub Switcher Pill Bar when manager has multiple hubs or Super-Admin is previewing */}
        {(accessibleHubs.length > 1 || isSuperOrAdmin) && (
          <div
            data-testid="hub-manager-branch-switcher"
            className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80"
          >
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] shrink-0">
                Assigned Branch:
              </span>
              {accessibleHubs.map((hub) => {
                const isSelected = hub.id === selectedHub?.id;
                return (
                  <button
                    key={hub.id}
                    type="button"
                    data-testid={`hub-manager-switch-pill-${hub.slug}`}
                    onClick={() => handleSelectBranchHub(hub)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold border transition-all cursor-pointer shrink-0 ${
                      isSelected
                        ? 'bg-theme-primary text-theme-primary-foreground border-transparent shadow-xs'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-slate-200 dark:border-slate-700 hover:border-theme-primary'
                    }`}
                  >
                    <MapPin className="h-3 w-3" />
                    <span>{hub.name}</span>
                    <span
                      className={`text-[10px] font-medium ${
                        isSelected
                          ? 'opacity-85'
                          : 'text-[var(--ps-text-muted)]'
                      }`}
                    >
                      ({hub.state})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold ${
                  canConfirmManualPayments
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20'
                }`}
              >
                <Shield className="h-3 w-3" />
                {canConfirmManualPayments
                  ? 'Manual UPI Delegation: Enabled'
                  : 'Manual UPI: Central Super-Admin'}
              </span>
              {canEditHubRates && (
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 px-2 py-0.5 font-semibold">
                  Rate Edits Enabled
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inline Feedback Banner */}
      {bannerNotice && (
        <div
          role="status"
          data-testid="hub-manager-notice-banner"
          className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold ${
            bannerNotice.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : bannerNotice.type === 'error'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {bannerNotice.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{bannerNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 6 Compact Horizontally Scrollable Workspace Tabs */}
      <div
        role="tablist"
        aria-label="Hub Manager Workspace Tabs"
        className="flex w-full max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto no-scrollbar rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-1.5"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`hub-manager-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-all shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span
                  className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold ${
                    isActive
                      ? 'bg-white/20 text-theme-primary-foreground'
                      : 'bg-slate-200 dark:bg-slate-800 text-[var(--ps-text)]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          TAB 1: OVERVIEW & SWITCHES
          ===================================================================== */}
      {activeTab === 'overview' && (
        <div
          data-testid="hub-manager-panel-overview"
          className="space-y-4"
        >
          {/* Pass R6: Live Hub Command Overview KPIs & 9-Switch Module Matrix */}
          {selectedHub?.id && (
            <HubCommandOverviewCard
              hubId={selectedHub.id}
              hubName={selectedHub.name}
              moduleSwitches={selectedHub.module_switches}
              onSelectTab={(tab) => setActiveTab(tab)}
            />
          )}

          {/* 6 Hub KPI Tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
                <span className="font-semibold">Listings in Hub</span>
                <Store className="h-4 w-4 text-theme-primary" />
              </div>
              <p
                data-testid="hub-kpi-listings"
                className="text-xl font-extrabold text-[var(--ps-text)]"
              >
                {hubListings.length}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                +{hubProducts.length} Marketplace Products
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
                <span className="font-semibold">Pending Localities</span>
                <MapPin className="h-4 w-4 text-amber-500" />
              </div>
              <p
                data-testid="hub-kpi-pending-localities"
                className="text-xl font-extrabold text-[var(--ps-text)]"
              >
                {pendingLocalitiesCount}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {hubLocalitiesList.filter((l) => l.status === 'verified').length}{' '}
                verified vengs in pool
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
                <span className="font-semibold">Active Pick N Drop</span>
                <Truck className="h-4 w-4 text-emerald-500" />
              </div>
              <p
                data-testid="hub-kpi-active-orders"
                className="text-xl font-extrabold text-[var(--ps-text)]"
              >
                {activeOrdersCount}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {hubDrivers.filter((d) => d.is_available).length} drivers online
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
                <span className="font-semibold">Hub Bookings</span>
                <Calendar className="h-4 w-4 text-blue-500" />
              </div>
              <p
                data-testid="hub-kpi-bookings"
                className="text-xl font-extrabold text-[var(--ps-text)]"
              >
                {hubBookings.length}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Scheduled trips in {selectedHub?.name}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('print_digital')}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 space-y-1 text-left hover:border-theme-primary/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
                <span className="font-semibold">Active Print Orders (Hub)</span>
                <Printer className="h-4 w-4 text-theme-primary" />
              </div>
              <p
                data-testid="hub-kpi-active-print-orders"
                className="text-xl font-extrabold text-[var(--ps-text)] tabular-nums"
              >
                {hubActivePrintOrdersCount}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {moduleSwitchesDraft.print_orders?.enabled
                  ? 'Print & Digital live'
                  : 'Paused in hub'}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('public_civic')}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 space-y-1 text-left hover:border-theme-primary/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
                <span className="font-semibold">Pending Civic Reports</span>
                <Landmark className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              </div>
              <p
                data-testid="hub-kpi-pending-civic-reports"
                className="text-xl font-extrabold text-[var(--ps-text)] tabular-nums"
              >
                {hubPendingCivicReportsCount}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Official public &amp; govt desk
              </p>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Local Module Pause Switches */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[var(--ps-text)]">
                    Local Module Pause Switches ({selectedHub?.name})
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Pause or resume modules specifically for {selectedHub?.name}{' '}
                    without affecting other regional hubs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveHubModuleSwitches()}
                  disabled={isSavingSwitches}
                  data-testid="hub-save-module-switches-btn"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isSavingSwitches ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Switches</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {MODULE_SWITCH_DEFINITIONS.map((mod) => {
                  const current = moduleSwitchesDraft[mod.key];
                  return (
                    <div
                      key={mod.key}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--ps-text)]">
                              {mod.label}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                current?.enabled
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {current?.enabled ? 'Active' : 'Paused in Hub'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                            {mod.description}
                          </p>
                        </div>

                        <button
                          type="button"
                          data-testid={`hub-module-toggle-${mod.key}`}
                          onClick={() =>
                            setModuleSwitchesDraft((prev) => ({
                              ...prev,
                              [mod.key]: {
                                ...prev[mod.key],
                                enabled: !prev[mod.key].enabled,
                              },
                            }))
                          }
                          className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold border transition-colors cursor-pointer ${
                            current?.enabled
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {current?.enabled ? (
                            <ToggleRight className="h-4 w-4" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                          <span>{current?.enabled ? 'On' : 'Paused'}</span>
                        </button>
                      </div>

                      <input
                        type="text"
                        value={current?.pause_message || ''}
                        onChange={(e) =>
                          setModuleSwitchesDraft((prev) => ({
                            ...prev,
                            [mod.key]: {
                              ...prev[mod.key],
                              pause_message: e.target.value,
                            },
                          }))
                        }
                        placeholder={
                          mod.key === 'print_orders'
                            ? 'e.g. District power outage — online print ordering paused temporarily'
                            : `Custom pause notice for ${mod.label} in ${selectedHub?.name}…`
                        }
                        data-testid={`hub-module-message-${mod.key}`}
                        className="w-full h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Local Branch Contact Editor */}
            <form
              onSubmit={(e) => void handleSaveHubOfficeContact(e)}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[var(--ps-text)]">
                    Local Branch Contact ({selectedHub?.name})
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Displayed in the footer, help desk, and customer receipts when{' '}
                    {selectedHub?.name} is active.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={isSavingContact}
                  data-testid="hub-save-office-contact-btn"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isSavingContact ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Contact</span>
                </button>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-[var(--ps-text-muted)] mb-1">
                    Branch Office Address
                  </label>
                  <input
                    type="text"
                    value={officeContactDraft.address || ''}
                    onChange={(e) =>
                      setOfficeContactDraft((prev) => ({
                        ...prev,
                        address: e.target.value,
                      }))
                    }
                    data-testid="hub-office-address-input"
                    placeholder="e.g. Zarkawt Main Road, Aizawl"
                    className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <PhoneInput
                    label="Branch Phone"
                    variant="sm"
                    value={officeContactDraft.phone || ''}
                    onChange={(val) =>
                      setOfficeContactDraft((prev) => ({
                        ...prev,
                        phone: val,
                      }))
                    }
                    testId="hub-office-phone-input"
                  />
                  <PhoneInput
                    label="Branch WhatsApp"
                    variant="sm"
                    value={officeContactDraft.whatsapp || ''}
                    onChange={(val) =>
                      setOfficeContactDraft((prev) => ({
                        ...prev,
                        whatsapp: val,
                      }))
                    }
                    testId="hub-office-whatsapp-input"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-[var(--ps-text-muted)] mb-1">
                      Support Email
                    </label>
                    <input
                      type="email"
                      value={officeContactDraft.email || ''}
                      onChange={(e) =>
                        setOfficeContactDraft((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }))
                      }
                      data-testid="hub-office-email-input"
                      placeholder="hub@ddoodle.in"
                      className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[var(--ps-text-muted)] mb-1">
                      Operating Hours
                    </label>
                    <input
                      type="text"
                      value={officeContactDraft.operating_hours || ''}
                      onChange={(e) =>
                        setOfficeContactDraft((prev) => ({
                          ...prev,
                          operating_hours: e.target.value,
                        }))
                      }
                      data-testid="hub-office-hours-input"
                      placeholder="Mon–Sat, 8:00 AM – 8:00 PM"
                      className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: LISTINGS & PRODUCTS
          ===================================================================== */}
      {activeTab === 'listings' && (
        <div
          data-testid="hub-manager-panel-listings"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'All Catalog' },
                  { id: 'listings', label: `Listings (${hubListings.length})` },
                  { id: 'products', label: `Products (${hubProducts.length})` },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setCatalogViewFilter(pill.id)}
                  className={`h-8 px-2.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    catalogViewFilter === pill.id
                      ? 'bg-theme-primary text-theme-primary-foreground border-transparent'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-56">
                <Search className="h-3.5 w-3.5 text-[var(--ps-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder={`Search ${selectedHub?.name} listings & products…`}
                  className="w-full h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] pl-8 pr-2.5 text-xs text-[var(--ps-text)]"
                />
              </div>
              <div className="w-40">
                <CustomSelectModal
                  options={[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'published', label: 'Published / Active' },
                    { value: 'draft', label: 'Pending / Draft' },
                    { value: 'archived', label: 'Archived' },
                  ]}
                  value={catalogStatusFilter}
                  onChange={setCatalogStatusFilter}
                  testId="hub-catalog-status-select"
                  className="[&>button]:min-h-[32px] [&>button]:h-8 [&>button]:py-1"
                />
              </div>
            </div>
          </div>

          {/* Directory Listings Section */}
          {(catalogViewFilter === 'all' || catalogViewFilter === 'listings') && (
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Directory Listings in {selectedHub?.name} ({filteredListings.length})
              </h3>
              {filteredListings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No directory listings found for {selectedHub?.name}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                  {filteredListings.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                            {item.title}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              item.status === 'published'
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : item.status === 'draft'
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {item.status}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ps-text-muted)]">
                            {item.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          {item.locality || selectedHub?.name}
                          {item.owner_name ? ` • Owner: ${item.owner_name}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {onOpenListingOnMap && (
                          <button
                            type="button"
                            onClick={() => onOpenListingOnMap(item.id)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                          >
                            <MapPin className="h-3 w-3 text-theme-primary" />
                            <span>Map</span>
                          </button>
                        )}
                        {item.status !== 'published' && (
                          <button
                            type="button"
                            disabled={busyCatalogId === item.id}
                            onClick={() =>
                              void handleUpdateListingStatus(item.id, 'published')
                            }
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Approve</span>
                          </button>
                        )}
                        {item.status !== 'archived' && (
                          <button
                            type="button"
                            disabled={busyCatalogId === item.id}
                            onClick={() =>
                              void handleUpdateListingStatus(item.id, 'archived')
                            }
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Marketplace Products Section */}
          {(catalogViewFilter === 'all' || catalogViewFilter === 'products') && (
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Marketplace Products in {selectedHub?.name} ({filteredProducts.length})
              </h3>
              {filteredProducts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No marketplace products found for {selectedHub?.name}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                  {filteredProducts.map((prod) => (
                    <div
                      key={prod.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                            {prod.title}
                          </span>
                          <span className="text-xs font-extrabold text-theme-primary">
                            ₹{Number(prod.price_inr || 0).toLocaleString('en-IN')}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              prod.is_active
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {prod.is_active ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          Category: {prod.category}
                          {prod.seller_name ? ` • Seller: ${prod.seller_name}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={busyCatalogId === prod.id}
                          onClick={() =>
                            void handleToggleProductActive(
                              prod.id,
                              !prod.is_active
                            )
                          }
                          className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold cursor-pointer disabled:opacity-50 ${
                            prod.is_active
                              ? 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          {prod.is_active ? (
                            <>
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>Approve</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 3: LOCALITY POOL (Verify, Rename, Atomic Merge into Canonical)
          ===================================================================== */}
      {activeTab === 'localities' && (
        <div
          data-testid="hub-manager-panel-localities"
          className="space-y-4"
        >
          {/* Add Verified Locality Bar */}
          <form
            onSubmit={(e) => void handleAddVerifiedLocality(e)}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
          >
            <input
              type="text"
              value={newLocalityName}
              onChange={(e) => setNewLocalityName(e.target.value)}
              placeholder={`Add official veng / locality in ${selectedHub?.name} (e.g. Dawrpui, Rengkai)…`}
              data-testid="hub-add-locality-name-input"
              className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
            />
            <input
              type="text"
              value={newLocalityAliases}
              onChange={(e) => setNewLocalityAliases(e.target.value)}
              placeholder="Optional aliases (comma-separated)…"
              data-testid="hub-add-locality-aliases-input"
              className="sm:w-64 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
            />
            <button
              type="submit"
              disabled={isAddingLocality || !newLocalityName.trim()}
              data-testid="hub-add-locality-submit-btn"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isAddingLocality ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>Add Verified Veng</span>
            </button>
          </form>

          {/* Locality Pool Queue */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `All (${hubLocalitiesList.length})` },
                    {
                      id: 'pending',
                      label: `Pending (${pendingLocalitiesCount})`,
                    },
                    {
                      id: 'verified',
                      label: `Verified (${
                        hubLocalitiesList.filter((l) => l.status === 'verified')
                          .length
                      })`,
                    },
                    {
                      id: 'merged',
                      label: `Merged (${
                        hubLocalitiesList.filter((l) => l.status === 'merged')
                          .length
                      })`,
                    },
                  ] as const
                ).map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    data-testid={`hub-locality-filter-${pill.id}`}
                    onClick={() => setLocalityStatusFilter(pill.id)}
                    className={`h-8 px-2.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      localityStatusFilter === pill.id
                        ? 'bg-theme-primary text-theme-primary-foreground border-transparent'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>

              <div className="relative sm:w-64">
                <Search className="h-3.5 w-3.5 text-[var(--ps-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={localitySearch}
                  onChange={(e) => setLocalitySearch(e.target.value)}
                  placeholder="Search veng name or alias…"
                  className="w-full h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] pl-8 pr-2.5 text-xs text-[var(--ps-text)]"
                />
              </div>
            </div>

            {filteredLocalities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                No localities match this filter in {selectedHub?.name}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                {filteredLocalities.map((loc) => {
                  const isEditing = editingLocalityId === loc.id;
                  const isBusy = busyLocalityId === loc.id;
                  const mergeOptionsForRow = verifiedLocalitiesOptions.filter(
                    (opt) => opt.value !== loc.id
                  );
                  const selectedMergeTarget =
                    mergeTargetBySourceId[loc.id] || '';

                  return (
                    <div
                      key={loc.id}
                      data-testid={`hub-locality-row-${loc.slug}`}
                      className="p-3 space-y-2"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                        <div className="min-w-0 space-y-1">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingLocalityName}
                                onChange={(e) =>
                                  setEditingLocalityName(e.target.value)
                                }
                                data-testid={`hub-locality-rename-input-${loc.slug}`}
                                className="h-8 rounded-lg border border-theme-primary bg-[var(--ps-surface)] px-2.5 text-xs font-bold text-[var(--ps-text)]"
                              />
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleRenameLocality(loc)}
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-theme-primary px-2.5 text-xs font-bold text-theme-primary-foreground cursor-pointer"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>Save</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLocalityId(null);
                                  setEditingLocalityName('');
                                }}
                                className="inline-flex h-8 items-center rounded-lg border border-slate-200 dark:border-slate-700 px-2 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-extrabold text-[var(--ps-text)]">
                                {loc.display_name}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                  loc.status === 'verified'
                                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : loc.status === 'pending'
                                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                      : 'bg-slate-200 dark:bg-slate-800 text-[var(--ps-text-muted)]'
                                }`}
                              >
                                {loc.status}
                              </span>
                              <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                                Source: {loc.source}
                              </span>
                              <span className="inline-flex items-center rounded-md bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-theme-primary">
                                {loc.usage_count || 0} uses
                              </span>
                              {typeof loc.lat === 'number' &&
                                typeof loc.lng === 'number' && (
                                  <span className="text-[10px] text-[var(--ps-text-muted)] font-mono">
                                    ({loc.lat.toFixed(4)}, {loc.lng.toFixed(4)})
                                  </span>
                                )}
                            </div>
                          )}

                          {loc.aliases && loc.aliases.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                                Aliases:
                              </span>
                              {loc.aliases.map((alias) => (
                                <span
                                  key={alias}
                                  className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ps-text)]"
                                >
                                  {alias}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions: Verify, Rename, Merge into Canonical */}
                        {loc.status !== 'merged' && (
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {loc.status === 'pending' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                data-testid={`hub-locality-verify-btn-${loc.slug}`}
                                onClick={() => void handleVerifyLocality(loc)}
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Verify</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isBusy}
                              data-testid={`hub-locality-rename-btn-${loc.slug}`}
                              onClick={() => {
                                setEditingLocalityId(loc.id);
                                setEditingLocalityName(loc.display_name);
                              }}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Rename</span>
                            </button>

                            {mergeOptionsForRow.length > 0 && (
                              <div className="flex items-center gap-1.5">
                                <div className="w-48">
                                  <CustomSelectModal
                                    options={mergeOptionsForRow}
                                    value={selectedMergeTarget}
                                    onChange={(targetId) => {
                                      setMergeTargetBySourceId((prev) => ({
                                        ...prev,
                                        [loc.id]: targetId,
                                      }));
                                      void handleMergeLocalityIntoCanonical(
                                        loc,
                                        targetId
                                      );
                                    }}
                                    placeholder="Merge into Canonical…"
                                    testId={`hub-locality-merge-select-${loc.slug}`}
                                    className="[&>button]:min-h-[32px] [&>button]:h-8 [&>button]:py-1"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hub Suggested Category Triage Queue (v21b P1-08) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Suggested Categories Triage ({hubSuggestedCategories.length})
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Pre-vet local leaf category suggestions before Superadmin global taxonomy approval.
                </p>
              </div>
            </div>
            {hubSuggestedCategories.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center text-xs text-[var(--ps-text-muted)]">
                No pending suggested leaf categories for {selectedHub?.name}.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                {hubSuggestedCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-[var(--ps-text)]">
                          {cat.display_name}
                        </span>
                        {cat.root_key && (
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                            {cat.root_key.replace(/_/g, ' ')}
                          </span>
                        )}
                        {cat.hub_triage_status && (
                          <span className="rounded bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-theme-primary">
                            {cat.hub_triage_status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busyCategoryTriageId === cat.id}
                        onClick={() =>
                          void handleTriageSuggestedCategory(
                            cat.id,
                            cat.display_name,
                            'recommend_approve'
                          )
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white cursor-pointer disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Recommend Approve</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyCategoryTriageId === cat.id}
                        onClick={() =>
                          void handleTriageSuggestedCategory(
                            cat.id,
                            cat.display_name,
                            'recommend_reject'
                          )
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Recommend Reject</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: PICK N DROP & FLEET
          ===================================================================== */}
      {activeTab === 'fleet' && (
        <div
          data-testid="hub-manager-panel-fleet"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'orders',
                  label: `Delivery Orders (${hubOrders.length})`,
                },
                {
                  id: 'bookings',
                  label: `Vehicle Bookings (${hubBookings.length})`,
                },
                {
                  id: 'drivers',
                  label: `Hub Drivers (${hubDrivers.length})`,
                },
                {
                  id: 'vehicles',
                  label: `Hub Vehicles (${hubVehicles.length})`,
                },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                data-testid={`hub-fleet-subtab-${pill.id}`}
                onClick={() => setFleetSubSection(pill.id)}
                className={`h-8 px-3 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  fleetSubSection === pill.id
                    ? 'bg-theme-primary text-theme-primary-foreground border-transparent'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-slate-200 dark:border-slate-700'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Delivery Orders in Hub */}
          {fleetSubSection === 'orders' && (
            <div className="space-y-2.5">
              {hubOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No Pick N Drop orders recorded for {selectedHub?.name} yet.
                </div>
              ) : (
                hubOrders.map((order) => {
                  const isBusy = busyFleetItemId === order.id;
                  const signedPod = signedPodUrlByOrder[order.id];
                  return (
                    <div
                      key={order.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-extrabold text-[var(--ps-text)] font-mono">
                              {order.order_code || order.id.slice(0, 8)}
                            </span>
                            <span className="inline-flex items-center rounded-md bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-theme-primary">
                              {order.status}
                            </span>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                              ₹
                              {Number(
                                order.final_fare_inr ??
                                  order.quoted_fare_inr ??
                                  0
                              ).toLocaleString('en-IN')}
                            </span>
                            {order.upi_utr_ref && (
                              <span className="text-[10px] font-mono text-[var(--ps-text-muted)]">
                                UTR: {order.upi_utr_ref}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            <strong>Pickup:</strong> {order.pickup_address} →{' '}
                            <strong>Drop:</strong> {order.drop_address}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {order.pod_storage_path && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleOpenSignedPod(order)}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 text-xs font-bold text-blue-700 dark:text-blue-300 cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>5m Signed POD</span>
                            </button>
                          )}
                          {signedPod && (
                            <a
                              href={signedPod}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>Open POD Image</span>
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        <CustomSelectModal
                          options={driverSelectOptions}
                          value={
                            assignDriverByOrder[order.id] ??
                            order.driver_id ??
                            ''
                          }
                          onChange={(val) =>
                            setAssignDriverByOrder((prev) => ({
                              ...prev,
                              [order.id]: val,
                            }))
                          }
                          placeholder="Assign Hub Driver"
                          testId={`hub-order-driver-select-${order.id}`}
                          className="[&>button]:min-h-[32px] [&>button]:h-8 [&>button]:py-1"
                        />

                        <CustomSelectModal
                          options={vehicleSelectOptions}
                          value={
                            assignVehicleByOrder[order.id] ??
                            order.vehicle_id ??
                            ''
                          }
                          onChange={(val) =>
                            setAssignVehicleByOrder((prev) => ({
                              ...prev,
                              [order.id]: val,
                            }))
                          }
                          placeholder="Assign Fleet Vehicle"
                          testId={`hub-order-vehicle-select-${order.id}`}
                          className="[&>button]:min-h-[32px] [&>button]:h-8 [&>button]:py-1"
                        />

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleAssignOrderDriverAndStage(
                                order,
                                'driver_assigned'
                              )
                            }
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-theme-primary px-2.5 text-xs font-bold text-theme-primary-foreground cursor-pointer disabled:opacity-50"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>Assign & Dispatch</span>
                          </button>

                          {order.status !== 'completed' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleAssignOrderDriverAndStage(
                                  order,
                                  'completed'
                                )
                              }
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white cursor-pointer disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Complete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Vehicle Bookings in Hub */}
          {fleetSubSection === 'bookings' && (
            <div className="space-y-2.5">
              {hubBookings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No scheduled vehicle bookings in {selectedHub?.name} yet.
                </div>
              ) : (
                hubBookings.map((booking) => {
                  const isBusy = busyFleetItemId === booking.id;
                  return (
                    <div
                      key={booking.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-extrabold font-mono text-[var(--ps-text)]">
                            {booking.booking_code}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-theme-primary">
                            {booking.status}
                          </span>
                          <span className="text-xs font-bold text-[var(--ps-text)]">
                            {booking.passenger_name || 'Customer booking'}
                            {booking.passenger_phone ? ` (${booking.passenger_phone})` : ''}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          Trip: {booking.trip_date}{' '}
                          {booking.trip_time ? `at ${booking.trip_time}` : ''} •{' '}
                          {booking.pickup_address}
                          {booking.drop_address
                            ? ` → ${booking.drop_address}`
                            : ''}{' '}
                          • Advance Paid: ₹{booking.advance_paid_inr} / Total ₹
                          {booking.total_fare_inr}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {booking.status === 'pending_payment_confirm' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleUpdateBookingStatus(
                                  booking,
                                  'verify_upi'
                                )
                              }
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Verify UPI</span>
                            </button>
                          )}
                        {booking.status === 'completed' &&
                          !['released', 'refunded'].includes(
                            String(booking.escrow_status || '')
                          ) && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleUpdateBookingStatus(
                                booking,
                                'release_payout'
                              )
                            }
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-theme-primary px-2.5 text-xs font-bold text-theme-primary-foreground cursor-pointer"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Release Payout</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Hub Drivers */}
          {fleetSubSection === 'drivers' && (
            <div className="space-y-2">
              {hubDrivers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No drivers assigned to {selectedHub?.name} yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                  {hubDrivers.map((driver) => (
                    <div
                      key={driver.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--ps-text)]">
                            {driver.full_name}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                              driver.kyc_verified
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {driver.kyc_verified
                              ? 'KYC Approved'
                              : 'KYC Pending'}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                              driver.is_available
                                ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                                : 'bg-slate-200 dark:bg-slate-800 text-[var(--ps-text-muted)]'
                            }`}
                          >
                            {driver.is_available ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          Phone: {driver.phone}{' '}
                          {driver.license_number
                            ? `• DL: ${driver.license_number}`
                            : ''}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={busyFleetItemId === driver.id}
                        onClick={() => void handleToggleDriverKyc(driver)}
                        className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold cursor-pointer ${
                          driver.kyc_verified
                            ? 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>
                          {driver.kyc_verified ? 'Revoke KYC' : 'Approve KYC'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Hub Vehicles */}
          {fleetSubSection === 'vehicles' && (
            <div className="space-y-2">
              {hubVehicles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No fleet vehicles registered in {selectedHub?.name} yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                  {hubVehicles.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold font-mono text-[var(--ps-text)]">
                            {vehicle.plate_number}
                          </span>
                          <span className="text-xs font-semibold text-[var(--ps-text)]">
                            {vehicle.model_name || 'Fleet Vehicle'}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                              vehicle.is_active
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {vehicle.is_active ? 'Active' : 'Revoked'}
                          </span>
                        </div>
                        {vehicle.rc_number && (
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            RC: {vehicle.rc_number}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={busyFleetItemId === vehicle.id}
                        onClick={() => void handleToggleVehicleActive(vehicle)}
                        className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold cursor-pointer ${
                          vehicle.is_active
                            ? 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <span>
                          {vehicle.is_active
                            ? 'Revoke Vehicle'
                            : 'Approve Vehicle'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Scheduled Vehicle Listings Verification (v21b P1-08) */}
              <div className="pt-3 space-y-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Scheduled Seat / Charter Vehicle Listings ({hubVehicleListings.length})
                </h3>
                {hubVehicleListings.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center text-xs text-[var(--ps-text-muted)]">
                    No scheduled charter vehicle listings originating in {selectedHub?.name} yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                    {hubVehicleListings.map((vl) => (
                      <div
                        key={vl.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-[var(--ps-text)]">
                              {vl.title}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                vl.is_active
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {vl.is_active ? 'Active' : 'Paused'}
                            </span>
                            {vl.is_verified && (
                              <span className="inline-flex items-center rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                                Verified Stand
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            {vl.stand_locality || 'Stand TBD'} · {vl.total_seats || 4} seats
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busyFleetItemId === vl.id}
                          onClick={() =>
                            void handleVerifyVehicleListing(
                              vl.id,
                              vl.title,
                              !vl.is_active
                            )
                          }
                          className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold cursor-pointer disabled:opacity-50 ${
                            vl.is_active
                              ? 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          <span>
                            {vl.is_active ? 'Pause Listing' : 'Verify & Activate'}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 5: BULLETINS & PASSES
          ===================================================================== */}
      {activeTab === 'bulletins' && (
        <div
          data-testid="hub-manager-panel-bulletins"
          className="space-y-4"
        >
          {/* Bulletin Reports in Hub */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Bulletin Reports in {selectedHub?.name} ({hubBulletinReports.length})
            </h2>
            {hubBulletinReports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
                Zero pending community bulletin reports in {selectedHub?.name}.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                {hubBulletinReports.map((rep) => (
                  <div
                    key={rep.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-[var(--ps-text)]">
                          {rep.bulletin_title}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                          Reason: {rep.reason}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                          Status: {rep.status}
                        </span>
                      </div>
                      {rep.details && (
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          {rep.details}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busyBulletinItemId === rep.id}
                        onClick={() =>
                          void handleResolveBulletinReport(rep, 'dismiss')
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                      >
                        <span>Dismiss</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyBulletinItemId === rep.id}
                        onClick={() =>
                          void handleResolveBulletinReport(
                            rep,
                            'remove_bulletin'
                          )
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-600 px-2.5 text-xs font-bold text-white cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Remove Post</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bulletin Post Passes & Subscriptions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-2.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Single Bulletin Passes ({hubBulletinPasses.length})
              </h3>
              {hubBulletinPasses.length === 0 ? (
                <p className="text-xs text-[var(--ps-text-muted)] py-4 text-center">
                  No single bulletin passes recorded for this hub.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                  {hubBulletinPasses.map((pass) => (
                    <div
                      key={pass.id}
                      className="flex items-center justify-between gap-2 p-2.5 text-xs"
                    >
                      <div>
                        <span className="font-bold text-[var(--ps-text)]">
                          ₹{pass.amount_inr} • {pass.duration_days} Days Pass
                        </span>
                        <p className="text-[10px] text-[var(--ps-text-muted)] font-mono">
                          UTR: {pass.upi_utr_ref || 'Online'}
                        </p>
                      </div>
                      <span className="inline-flex items-center rounded-md bg-theme-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-theme-primary">
                        {pass.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-2.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Publisher Subscriptions ({hubSubscriptions.length})
              </h3>
              {hubSubscriptions.length === 0 ? (
                <p className="text-xs text-[var(--ps-text-muted)] py-4 text-center">
                  No publisher subscriptions recorded for this hub.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
                  {hubSubscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between gap-2 p-2.5 text-xs"
                    >
                      <div>
                        <span className="font-bold text-[var(--ps-text)] uppercase">
                          Plan: {sub.plan_id}
                        </span>
                        <p className="text-[10px] text-[var(--ps-text-muted)] font-mono">
                          Ref: {sub.payment_ref || 'N/A'}
                        </p>
                      </div>
                      <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                        {sub.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 6: HUB PAYMENTS (Delegated Manual UPI Confirmation)
          ===================================================================== */}
      {activeTab === 'payments' && (
        <div
          data-testid="hub-manager-panel-payments"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3"
        >
          {/* Delegation Policy Banner when canConfirmManualPayments === false */}
          {!canConfirmManualPayments && (
            <div
              data-testid="hub-payments-central-superadmin-badge"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200"
            >
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="font-semibold">
                  Manual UPI confirmation is centrally handled by Super-Admin for
                  this hub.
                </span>
              </div>
              {actualRole === 'super_admin' && (
                <span className="inline-flex items-center gap-1 rounded-md bg-purple-600/15 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300 shrink-0">
                  Super-Admin Override Active
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${hubPaymentIntents.length})` },
                  {
                    id: 'pending',
                    label: `Pending Verification (${
                      hubPaymentIntents.filter(
                        (p) =>
                          p.status === 'pending_manual' ||
                          p.status === 'awaiting_payment'
                      ).length
                    })`,
                  },
                  {
                    id: 'succeeded',
                    label: `Succeeded (${
                      hubPaymentIntents.filter((p) => p.status === 'succeeded')
                        .length
                    })`,
                  },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setPaymentStatusFilter(pill.id)}
                  className={`h-8 px-2.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    paymentStatusFilter === pill.id
                      ? 'bg-theme-primary text-theme-primary-foreground border-transparent'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {filteredPaymentIntents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
              No payment intents recorded for {selectedHub?.name}.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
              {filteredPaymentIntents.map((intent) => {
                const isPending =
                  intent.status === 'pending_manual' ||
                  intent.status === 'awaiting_payment';
                const isBusy = busyIntentId === intent.id;

                return (
                  <div
                    key={intent.id}
                    data-testid={`hub-payment-intent-row-${intent.intent_code}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-extrabold font-mono text-[var(--ps-text)]">
                          {intent.intent_code}
                        </span>
                        <span className="text-xs font-extrabold text-theme-primary">
                          ₹{Number(intent.amount_inr || 0).toLocaleString('en-IN')}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text)]">
                          {intent.purpose.replace(/_/g, ' ')}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            intent.status === 'succeeded'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : isPending
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                : 'bg-slate-200 dark:bg-slate-800 text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {intent.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)] font-mono">
                        Provider: {intent.provider} • UTR:{' '}
                        {intent.upi_utr_ref || 'Not submitted'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isPending && canExecuteManualPaymentFulfillment ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          data-testid={`hub-payment-fulfill-btn-${intent.intent_code}`}
                          onClick={() =>
                            void handleFulfillHubPaymentIntent(intent)
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          <span>Approve & Fulfill</span>
                        </button>
                      ) : isPending ? (
                        <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          <Lock className="h-3 w-3" />
                          <span>Awaiting Super-Admin</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB: REAL ESTATE GOVERNANCE (PATTA/SITE VERIFY + SITE VISIT MONITOR)
          ===================================================================== */}
      {activeTab === 'real_estate' && selectedHub && (
        <HubRealEstateGovernancePanel
          hubId={selectedHub.id}
          hubName={selectedHub.name}
        />
      )}

      {/* =====================================================================
          TAB: SHOPS & FOOD GOVERNANCE (STORE/FSSAI/UPI VERIFY + MONITOR)
          ===================================================================== */}
      {activeTab === 'shops_food' && selectedHub && (
        <HubCommerceGovernancePanel
          hubId={selectedHub.id}
          hubName={selectedHub.name}
        />
      )}

      {/* =====================================================================
          TAB: BOOKINGS & STAYS GOVERNANCE (AMENITY/UPI VERIFY + OVERVIEW)
          ===================================================================== */}
      {activeTab === 'bookings_stays' && selectedHub && (
        <HubBookingsGovernancePanel
          hubId={selectedHub.id}
          hubName={selectedHub.name}
          onNotice={(n) => showNotice(n.type, n.text)}
        />
      )}

      {/* =====================================================================
          TAB: PRINT & DIGITAL GOVERNANCE (METADATA-ONLY, ZERO PDF ACCESS)
          ===================================================================== */}
      {activeTab === 'print_digital' && selectedHub && (
        <HubPrintGovernancePanel
          selectedHub={selectedHub}
          onNotice={showNotice}
          onActivePrintCountChange={setHubActivePrintOrdersCount}
        />
      )}

      {/* =====================================================================
          TAB: PUBLIC & CIVIC SERVICES DESK (SCOPED TO MANAGED HUB)
          ===================================================================== */}
      {activeTab === 'public_civic' && selectedHub && (
        <CivicDirectoryManager
          hubId={selectedHub.id}
          onPendingReportsCountChange={setHubPendingCivicReportsCount}
          onNotice={setBannerNotice}
        />
      )}

      {/* =====================================================================
          TAB: PARTNER, DRIVER & ADVERTISER APPLICATIONS (SCOPED TO MANAGED HUB)
          ===================================================================== */}
      {activeTab === 'applications' && selectedHub && (
        <PartnerApplicationsPanel
          hubId={selectedHub.id}
          hubs={hubs}
          onPendingCountChange={setHubPendingApplicationsCount}
          onNotice={setBannerNotice}
        />
      )}

      {/* =====================================================================
          TAB: REFERRALS TRACKING DESK (SCOPED TO MANAGED HUB)
          ===================================================================== */}
      {activeTab === 'referrals' && selectedHub && (
        <ReferralsTrackingPanel
          hubId={selectedHub.id}
          hubs={hubs}
          isSuperAdmin={false}
          onPendingCountChange={setHubPendingReferralsCount}
          onNotice={setBannerNotice}
        />
      )}

      {activeTab === 'featured' && selectedHub && (
        <FeaturedPlacementsPanel
          scopeHubId={selectedHub.id}
          scopeHubName={selectedHub.name}
          onNotice={setBannerNotice}
        />
      )}

      {/* =====================================================================
          TAB: HUB-SCOPED AUDIT TRAIL (v21b P1-08)
          ===================================================================== */}
      {activeTab === 'audit_logs' && selectedHub && (
        <div
          data-testid="hub-manager-panel-audit-logs"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3"
        >
          <div>
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              {selectedHub.name} Hub Audit Trail ({hubAuditLogs.length})
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Immutable zone-scoped governance log for actions performed inside {selectedHub.name}.
            </p>
          </div>
          {hubAuditLogs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
              No hub-scoped audit entries recorded yet for {selectedHub.name}.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]">
              {hubAuditLogs.map((log) => (
                <div key={log.id} className="p-3 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-[var(--ps-text)]">
                        {log.action}
                      </span>
                      {log.target_name && (
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                          {log.target_name}
                        </span>
                      )}
                      <span className="rounded bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-theme-primary">
                        {log.workspace || 'hub_manager'}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                      {(log.timestamp || '').replace('T', ' ').slice(0, 19)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    {log.actor_name || 'System'} ({log.actor_role || 'manager'}) —{' '}
                    {log.details || 'Action recorded'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmDangerDialog}
    </div>
  );
}
