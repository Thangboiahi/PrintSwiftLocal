'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Calendar,
  CalendarOff,
  Car,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  ImagePlus,
  KeyRound,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { QuickImageUploadField } from '@/components/workspaces/shared/QuickImageUploadField';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import { useHub } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type {
  VehicleAvailabilityBlockRecord,
  VehicleBookingMode,
  VehicleBookingRecord,
  VehicleFixedRoute,
  VehicleListingRecord,
  VehiclePricingModel,
} from '@/lib/payments/types';
import type { VehicleTypeItem } from '@/lib/pick-n-drop/types';
import { useAuth } from '@/lib/store';
import { getLimit } from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl, uploadImage } from '@/lib/supabase/storage';

export interface VehicleFleetCalendarManagerProps {
  /** 'listing' | 'calendar' locks to one view (for DriverWorkspace tabs); 'both' renders internal tabs (for OwnerWorkspace) */
  viewMode?: 'listing' | 'calendar' | 'both';
  driverRecordId?: string | null;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

interface HydratedBookingRow extends VehicleBookingRecord {
  vehicle_title: string;
  customer_name: string;
  customer_phone: string;
}

const LAMKA_STAND_PRESETS = [
  { label: 'Tuibong Bus Stand', lat: 24.3422, lng: 93.7048 },
  { label: 'Central Lamka / Police Station', lat: 24.3335, lng: 93.6978 },
  { label: 'New Lamka Traffic Point', lat: 24.3248, lng: 93.6921 },
  { label: 'Rengkai Road Stand', lat: 24.3374, lng: 93.7115 },
  { label: 'Zenhang Lamka Stand', lat: 24.3212, lng: 93.6869 },
] as const;

const BOOKING_MODE_OPTIONS: CustomSelectOption[] = [
  {
    value: 'full_vehicle',
    label: 'Full Vehicle Charter Only',
    description: 'Customers reserve the entire vehicle exclusively',
  },
  {
    value: 'per_seat',
    label: 'Per-Seat Shared Service Only',
    description: 'Customers book individual seats on scheduled trips',
  },
  {
    value: 'both',
    label: 'Both Full Vehicle & Per-Seat',
    description: 'Allow either full charter or individual seat reservations',
  },
];

const PRICING_MODEL_OPTIONS: CustomSelectOption[] = [
  {
    value: 'daily',
    label: 'Daily Charter',
    description: 'Ideal for outstation, hills, and full-day bookings',
  },
  {
    value: 'hourly',
    label: 'Hourly Local Hire',
    description: 'Local town trips and short hourly charters',
  },
  {
    value: 'fixed_route',
    label: 'Fixed Route (e.g. Lamka ↔ Imphal)',
    description: 'Predefined origin-destination fares per seat or charter',
  },
  {
    value: 'per_km',
    label: 'Per-Kilometre Rate',
    description: 'Distance-based charter rate per km',
  },
];

const BLOCK_REASON_OPTIONS: CustomSelectOption[] = [
  {
    value: 'offline_booking',
    label: 'Offline Booking',
    description: 'Booked via phone, WhatsApp, or walk-in at the stand',
  },
  {
    value: 'maintenance',
    label: 'Maintenance',
    description: 'Vehicle servicing, tyre check, or repairs',
  },
  {
    value: 'personal',
    label: 'Personal',
    description: 'Driver rest day or personal use',
  },
];

const FEATURE_SUGGESTIONS = [
  'AC',
  '4WD',
  'Luggage Carrier',
  'Doorstep Pickup',
  'Roof Carrier',
  'Hill Driver',
  'Pushback Seats',
  'Music System',
  'USB Charging',
  'First Aid Kit',
];

function formatDateTimeInputDefault(offsetHours: number): string {
  const dt = new Date(Date.now() + offsetHours * 3600000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:00`;
}

export function VehicleFleetCalendarManager({
  viewMode = 'both',
  driverRecordId = null,
  onNotice,
}: VehicleFleetCalendarManagerProps) {
  const { user: authUser } = useAuth();
  const { hubs, activeHub } = useHub();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { entitlements } = useEffectiveEntitlements(authUser?.id, null);
  const maxVehicleListingsLimit = getLimit(
    entitlements,
    'max_vehicle_listings'
  );
  const [innerTab, setInnerTab] = useState<'listing' | 'calendar'>('listing');
  const activeView = viewMode === 'both' ? innerTab : viewMode;

  const [isLoading, setIsLoading] = useState(true);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeItem[]>([]);
  const [myListings, setMyListings] = useState<VehicleListingRecord[]>([]);
  const [selectedListingId, setSelectedListingId] = useState<string>('new');
  const [bookings, setBookings] = useState<HydratedBookingRow[]>([]);
  const [blocks, setBlocks] = useState<VehicleAvailabilityBlockRecord[]>([]);

  // Listing Form Draft
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [standLocality, setStandLocality] = useState('Tuibong Bus Stand');
  const [lat, setLat] = useState('24.3422');
  const [lng, setLng] = useState('93.7048');
  const [bookingMode, setBookingMode] =
    useState<VehicleBookingMode>('full_vehicle');
  const [totalSeats, setTotalSeats] = useState('7');
  const [availableSeats, setAvailableSeats] = useState('7');
  const [vehicleRegNo, setVehicleRegNo] = useState('');
  const [operatorPhone, setOperatorPhone] = useState('');
  const [operatorWhatsapp, setOperatorWhatsapp] = useState('');
  const [originHubName, setOriginHubName] = useState('Lamka (Churachandpur)');
  const [destHubNames, setDestHubNames] = useState<string[]>(['Imphal']);
  const [pricingModel, setPricingModel] =
    useState<VehiclePricingModel>('daily');
  const [rateHourly, setRateHourly] = useState('');
  const [rateDaily, setRateDaily] = useState('3500');
  const [ratePerKm, setRatePerKm] = useState('22');
  const [advancePercent, setAdvancePercent] = useState('25');
  const [withDriver, setWithDriver] = useState(true);
  const [isActiveListing, setIsActiveListing] = useState(true);
  const [features, setFeatures] = useState<string[]>(['AC', 'Hill Driver']);
  const [customFeature, setCustomFeature] = useState('');
  const [fixedRoutes, setFixedRoutes] = useState<VehicleFixedRoute[]>([]);
  const [routeOrigin, setRouteOrigin] = useState('Lamka');
  const [routeDest, setRouteDest] = useState('Imphal');
  const [routeDepartureTime, setRouteDepartureTime] = useState('06:30 AM');
  const [routeFare, setRouteFare] = useState('350');
  const [routeFullFare, setRouteFullFare] = useState('3200');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [panoramaUrl, setPanoramaUrl] = useState('');

  // Calendar / Block Busy Dates Draft
  const [blockListingId, setBlockListingId] = useState('');
  const [blockStart, setBlockStart] = useState(() =>
    formatDateTimeInputDefault(2)
  );
  const [blockEnd, setBlockEnd] = useState(() =>
    formatDateTimeInputDefault(10)
  );
  const [blockReason, setBlockReason] = useState<
    'offline_booking' | 'maintenance' | 'personal'
  >('offline_booking');
  const [blockNotes, setBlockNotes] = useState('');

  // OTP Verification State per booking
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const populateFormFromListing = useCallback((row: VehicleListingRecord | null) => {
    if (!row) {
      setTitle('');
      setDescription('');
      setStandLocality('Tuibong Bus Stand');
      setLat('24.3422');
      setLng('93.7048');
      setBookingMode('full_vehicle');
      setTotalSeats('7');
      setAvailableSeats('7');
      setVehicleRegNo('');
      setOperatorPhone('');
      setOperatorWhatsapp('');
      setPricingModel('daily');
      setRateHourly('');
      setRateDaily('3500');
      setRatePerKm('22');
      setAdvancePercent('25');
      setWithDriver(true);
      setIsActiveListing(true);
      setFeatures(['AC', 'Hill Driver']);
      setFixedRoutes([]);
      setThumbnailUrl('');
      setImageUrls([]);
      setPanoramaUrl('');
      return;
    }
    const rowAny = row as VehicleListingRecord & {
      vehicle_reg_no?: string | null;
      available_seats?: number | null;
      operator_phone?: string | null;
      operator_whatsapp?: string | null;
    };
    setTitle(row.title || '');
    setDescription(row.description || '');
    setVehicleTypeId(row.vehicle_type_id || '');
    setStandLocality(row.stand_locality || 'Central Lamka');
    setLat(String(row.lat || 24.3335));
    setLng(String(row.lng || 93.6978));
    setBookingMode(row.booking_mode || 'full_vehicle');
    setTotalSeats(String(row.total_seats || 4));
    setAvailableSeats(
      String(rowAny.available_seats ?? row.total_seats ?? 4)
    );
    setVehicleRegNo(rowAny.vehicle_reg_no || '');
    setOperatorPhone(rowAny.operator_phone || '');
    setOperatorWhatsapp(rowAny.operator_whatsapp || '');
    setPricingModel(row.pricing_model || 'daily');
    setRateHourly(row.rate_hourly_inr != null ? String(row.rate_hourly_inr) : '');
    setRateDaily(row.rate_daily_inr != null ? String(row.rate_daily_inr) : '');
    setRatePerKm(row.rate_per_km_inr != null ? String(row.rate_per_km_inr) : '');
    setAdvancePercent(String(row.advance_percent ?? 25));
    setWithDriver(row.with_driver !== false);
    setIsActiveListing(row.is_active !== false);
    setFeatures(Array.isArray(row.features) ? row.features : []);
    setFixedRoutes(Array.isArray(row.fixed_routes) ? row.fixed_routes : []);
    setThumbnailUrl(row.thumbnail_url || '');
    setImageUrls(Array.isArray(row.image_urls) ? row.image_urls : []);
    setPanoramaUrl(row.panorama_url || '');
    const matchedOriginHub = row.origin_hub_id
      ? hubs.find((h) => h.id === row.origin_hub_id)
      : null;
    if (matchedOriginHub) {
      setOriginHubName(matchedOriginHub.name);
    }
    if (Array.isArray(row.destination_hub_ids) && row.destination_hub_ids.length > 0) {
      const names = row.destination_hub_ids
        .map((id) => hubs.find((h) => h.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      if (names.length > 0) {
        setDestHubNames(names);
      }
    }
  }, [hubs]);

  const authUserId = authUser?.id || '';

  const loadFleetData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id || authUserId;
      if (!uid) {
        setIsLoading(false);
        return;
      }

      const [vtRes, ownListingsRes, driverListingsRes] = await Promise.all([
        supabase
          .from('vehicle_types')
          .select('*')
          .eq('is_active', true)
          .order('base_fare_inr', { ascending: true }),
        supabase
          .from('vehicle_listings')
          .select('*')
          .eq('owner_id', uid)
          .order('updated_at', { ascending: false }),
        driverRecordId
          ? supabase
              .from('vehicle_listings')
              .select('*')
              .eq('driver_id', driverRecordId)
              .order('updated_at', { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);

      const vtList = (vtRes.data || []) as VehicleTypeItem[];
      setVehicleTypes(vtList);

      const mergedMap = new Map<string, VehicleListingRecord>();
      for (const row of (ownListingsRes.data || []) as VehicleListingRecord[]) {
        mergedMap.set(row.id, row);
      }
      for (const row of (driverListingsRes.data || []) as VehicleListingRecord[]) {
        mergedMap.set(row.id, row);
      }
      const listingsArr = Array.from(mergedMap.values());
      setMyListings(listingsArr);

      if (listingsArr.length > 0) {
        const first = listingsArr[0];
        setSelectedListingId((prev) =>
          prev !== 'new' && mergedMap.has(prev) ? prev : first.id
        );
        setBlockListingId((prev) => (prev && mergedMap.has(prev) ? prev : first.id));
        const activeRec =
          selectedListingId !== 'new' && mergedMap.has(selectedListingId)
            ? mergedMap.get(selectedListingId)!
            : first;
        populateFormFromListing(activeRec);
      } else {
        setSelectedListingId('new');
        if (vtList[0]?.id) {
          setVehicleTypeId((prev) => prev || vtList[0].id);
        }
      }

      const listingIds = listingsArr.map((l) => l.id);
      if (listingIds.length === 0) {
        setBookings([]);
        setBlocks([]);
        return;
      }

      const [bookingsRes, blocksRes] = await Promise.all([
        supabase
          .from('vehicle_bookings')
          .select('*')
          .in('vehicle_listing_id', listingIds)
          .order('start_time', { ascending: true })
          .limit(100),
        supabase
          .from('vehicle_availability_blocks')
          .select('*')
          .in('vehicle_listing_id', listingIds)
          .order('start_time', { ascending: true })
          .limit(100),
      ]);

      const rawBookings = (bookingsRes.data || []) as VehicleBookingRecord[];
      const customerIds = Array.from(
        new Set(rawBookings.map((b) => b.customer_id).filter(Boolean))
      );
      const customerMap = new Map<
        string,
        { full_name?: string | null; name?: string | null; phone?: string | null }
      >();

      if (customerIds.length > 0) {
        // v21a-r2: `profiles` is row-scoped — booking contacts come from the
        // owner-authorized `get_vehicle_booking_contacts` RPC (name + phone only).
        const { data: contacts } = await supabase.rpc('get_vehicle_booking_contacts', {
          p_booking_ids: rawBookings.map((b) => b.id).filter(Boolean),
        });
        if (Array.isArray(contacts)) {
          for (const c of contacts as Array<Record<string, unknown>>) {
            const id = String(c.customer_id || '');
            if (id && !customerMap.has(id)) {
              customerMap.set(id, {
                full_name: c.customer_name ? String(c.customer_name) : null,
                name: null,
                phone: c.customer_phone ? String(c.customer_phone) : null,
              });
            }
          }
        }
      }

      const hydratedBookings: HydratedBookingRow[] = rawBookings.map((b) => {
        const cust = customerMap.get(b.customer_id);
        const veh = mergedMap.get(b.vehicle_listing_id);
        return {
          ...b,
          total_fare_inr: Number(b.total_fare_inr || 0),
          advance_amount_inr: Number(b.advance_amount_inr || 0),
          balance_due_inr: Number(b.balance_due_inr || 0),
          vehicle_title: veh?.title || 'Vehicle Listing',
          customer_name: cust?.full_name || cust?.name || 'Customer',
          customer_phone: cust?.phone || '',
        };
      });

      setBookings(hydratedBookings);
      setBlocks((blocksRes.data || []) as VehicleAvailabilityBlockRecord[]);
    } catch (err) {
      setBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to load vehicle listings and schedule.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [authUserId, driverRecordId, populateFormFromListing, selectedListingId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadFleetData();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, driverRecordId]);

  const vehicleTypeOptions = useMemo<CustomSelectOption[]>(
    () =>
      vehicleTypes.map((vt) => ({
        value: vt.id,
        label: vt.name,
        description: `Base ₹${vt.base_fare_inr} · ₹${vt.per_km_rate_inr}/km`,
      })),
    [vehicleTypes]
  );

  const listingSelectOptions = useMemo<CustomSelectOption[]>(() => {
    const opts: CustomSelectOption[] = [
      {
        value: 'new',
        label: '+ Create New Vehicle Listing',
        description: 'Register a new charter, taxi, or fixed-route vehicle',
      },
    ];
    for (const item of myListings) {
      opts.push({
        value: item.id,
        label: item.title,
        description: `${item.stand_locality} · ${item.total_seats} seats`,
      });
    }
    return opts;
  }, [myListings]);

  const blockVehicleOptions = useMemo<CustomSelectOption[]>(
    () =>
      myListings.map((item) => ({
        value: item.id,
        label: item.title,
        description: item.stand_locality,
      })),
    [myListings]
  );

  const handleSelectListing = (nextId: string) => {
    setSelectedListingId(nextId);
    setBanner(null);
    if (nextId === 'new') {
      populateFormFromListing(null);
      if (vehicleTypes[0]?.id) setVehicleTypeId(vehicleTypes[0].id);
    } else {
      const found = myListings.find((l) => l.id === nextId) || null;
      populateFormFromListing(found);
    }
  };

  const handleUploadPhoto = async (
    files: FileList | null,
    target: 'gallery' | 'panorama'
  ) => {
    if (!files || files.length === 0 || !authUser?.id) return;
    setIsUploadingMedia(true);
    setAppStatus(
      'uploading',
      target === 'panorama' ? 'Uploading 360° interior…' : 'Uploading photo…'
    );
    try {
      const uploadedUrls: string[] = [];
      for (const file of Array.from(files).slice(0, target === 'panorama' ? 1 : 5)) {
        const res = await uploadImage(file, {
          folder: target === 'panorama' ? 'panoramas' : 'listings',
          entityId: authUser.id,
        });
        if (res.publicUrl) uploadedUrls.push(res.publicUrl);
      }

      if (target === 'panorama' && uploadedUrls[0]) {
        setPanoramaUrl(uploadedUrls[0]);
      } else if (uploadedUrls.length > 0) {
        setImageUrls((prev) => {
          const next = [...prev, ...uploadedUrls].slice(0, 8);
          if (!thumbnailUrl && next[0]) setThumbnailUrl(next[0]);
          return next;
        });
      }
      setAppStatus('success', 'Media uploaded');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Media upload failed.',
      });
      setAppStatus('error', 'Upload failed');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const hubOptions = useMemo<CustomSelectOption[]>(() => {
    const base = hubs.map((h) => ({
      value: h.name,
      label: h.name,
      description: h.state || undefined,
    }));
    return base.length > 0
      ? base
      : [
          { value: 'Lamka (Churachandpur)', label: 'Lamka (Churachandpur)' },
          { value: 'Imphal', label: 'Imphal' },
          { value: 'Aizawl', label: 'Aizawl' },
          { value: 'Shillong', label: 'Shillong' },
          { value: 'Guwahati', label: 'Guwahati' },
        ];
  }, [hubs]);

  const handleAddFixedRoute = () => {
    const o = routeOrigin.trim() || originHubName.trim();
    const d = routeDest.trim() || destHubNames[0] || '';
    const fare = Number(routeFare);
    if (!o || !d || !Number.isFinite(fare) || fare <= 0) return;
    const fullFare = Number(routeFullFare);
    const depSlot = routeDepartureTime.trim();
    const destLabel = depSlot ? `${d} (${depSlot})` : d;
    setFixedRoutes((prev) => [
      ...prev,
      {
        origin: o,
        destination: destLabel,
        fare_inr: Math.round(fare),
        ...(Number.isFinite(fullFare) && fullFare > 0
          ? { full_vehicle_fare_inr: Math.round(fullFare) }
          : {}),
      },
    ]);
    setRouteOrigin('');
    setRouteDest('');
    setRouteFare('');
    setRouteFullFare('');
  };

  const handleSaveListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser?.id) {
      setBanner({ type: 'error', text: 'Please sign in first.' });
      return;
    }
    if (
      selectedListingId === 'new' &&
      maxVehicleListingsLimit >= 0 &&
      myListings.length >= maxVehicleListingsLimit
    ) {
      setBanner({
        type: 'error',
        text: `Vehicle listing quota reached (${maxVehicleListingsLimit}). Upgrade your plan or contact admin.`,
      });
      return;
    }
    if (title.trim().length < 3) {
      setBanner({
        type: 'error',
        text: 'Enter a descriptive vehicle title (at least 3 characters).',
      });
      return;
    }
    const resolvedTypeId = vehicleTypeId || vehicleTypes[0]?.id;
    if (!resolvedTypeId) {
      setBanner({
        type: 'error',
        text: 'Vehicle types are not configured in the database yet.',
      });
      return;
    }

    const ok = await confirm({
      title:
        selectedListingId === 'new'
          ? 'Publish Vehicle Listing?'
          : 'Save Vehicle Listing Changes?',
      description: `Save "${title.trim()}" (${standLocality.trim() || 'Central Lamka'}, ${totalSeats} seats) to the live vehicle booking hub?`,
      confirmLabel:
        selectedListingId === 'new' ? 'Publish Vehicle' : 'Save Changes',
    });
    if (!ok) return;

    setBusyKey('save-listing');
    setBanner(null);
    setAppStatus('saving', 'Saving vehicle listing…');

    try {
      const parsedTotalSeats = Math.max(
        1,
        Math.min(60, Number(totalSeats) || 4)
      );
      const parsedAvailSeats = Math.max(
        0,
        Math.min(
          parsedTotalSeats,
          Number(availableSeats || parsedTotalSeats)
        )
      );
      const resolvedOriginHub =
        hubs.find(
          (h) =>
            h.name.toLowerCase() === originHubName.trim().toLowerCase() ||
            h.id === originHubName
        ) ||
        activeHub ||
        hubs[0] ||
        null;
      const resolvedDestHubIds = destHubNames
        .map(
          (name) =>
            hubs.find((h) => h.name.toLowerCase() === name.trim().toLowerCase())
              ?.id
        )
        .filter((id): id is string => Boolean(id));

      const basePayload = {
        owner_id: authUser.id,
        driver_id: driverRecordId || null,
        origin_hub_id: resolvedOriginHub?.id || activeHub?.id || null,
        destination_hub_ids: resolvedDestHubIds,
        vehicle_type_id: resolvedTypeId,
        title: title.trim(),
        description: description.trim() || null,
        stand_locality: standLocality.trim() || 'Central Lamka',
        lat: Number(lat) || 24.3335,
        lng: Number(lng) || 93.6978,
        booking_mode: bookingMode,
        total_seats: parsedTotalSeats,
        pricing_model: pricingModel,
        rate_hourly_inr: rateHourly ? Number(rateHourly) : null,
        rate_daily_inr: rateDaily ? Number(rateDaily) : null,
        rate_per_km_inr: ratePerKm ? Number(ratePerKm) : null,
        fixed_routes: fixedRoutes,
        advance_percent: Math.max(
          0,
          Math.min(100, Number(advancePercent) || 25)
        ),
        with_driver: withDriver,
        features,
        thumbnail_url: thumbnailUrl || imageUrls[0] || null,
        image_urls: imageUrls,
        panorama_url: panoramaUrl.trim() || null,
        is_active: isActiveListing,
      };
      const extendedPayload = {
        ...basePayload,
        vehicle_reg_no: vehicleRegNo.trim().toUpperCase() || null,
        available_seats: parsedAvailSeats,
        operator_phone: operatorPhone.trim() || null,
        operator_whatsapp: operatorWhatsapp.trim() || null,
      };

      const isMissingCol = (msg?: string) =>
        /column|schema cache|42703|PGRST204/i.test(String(msg || ''));

      if (selectedListingId === 'new') {
        let { data, error } = await supabase
          .from('vehicle_listings')
          .insert(extendedPayload)
          .select('*')
          .single();
        if (error && isMissingCol(error.message)) {
          const retry = await supabase
            .from('vehicle_listings')
            .insert(basePayload)
            .select('*')
            .single();
          data = retry.data;
          error = retry.error;
        }
        if (error) throw new Error(error.message);
        const created = data as VehicleListingRecord;
        setMyListings((prev) => [created, ...prev]);
        setSelectedListingId(created.id);
        setBlockListingId(created.id);
        const msg = `Published vehicle listing "${created.title}".`;
        setBanner({ type: 'success', text: msg });
        onNotice?.({ type: 'success', text: msg });
      } else {
        let { data, error } = await supabase
          .from('vehicle_listings')
          .update(extendedPayload)
          .eq('id', selectedListingId)
          .select('*')
          .single();
        if (error && isMissingCol(error.message)) {
          const retry = await supabase
            .from('vehicle_listings')
            .update(basePayload)
            .eq('id', selectedListingId)
            .select('*')
            .single();
          data = retry.data;
          error = retry.error;
        }
        if (error) throw new Error(error.message);
        const updated = data as VehicleListingRecord;
        setMyListings((prev) =>
          prev.map((l) => (l.id === updated.id ? updated : l))
        );
        const msg = `Saved changes to "${updated.title}".`;
        setBanner({ type: 'success', text: msg });
        onNotice?.({ type: 'success', text: msg });
      }
      setAppStatus('success', 'Vehicle listing saved');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save vehicle listing.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Save failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVehicleId = blockListingId || myListings[0]?.id;
    if (!targetVehicleId || !authUser?.id) {
      setBanner({
        type: 'error',
        text: 'Create a vehicle listing first before blocking dates.',
      });
      return;
    }
    const startDate = new Date(blockStart);
    const endDate = new Date(blockEnd);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      endDate <= startDate
    ) {
      setBanner({
        type: 'error',
        text: 'End date/time must be strictly after start date/time.',
      });
      return;
    }

    const ok = await confirm({
      title: 'Block Vehicle Availability Dates?',
      description:
        'This marks the selected vehicle as unavailable during this window on the public booking calendar.',
      confirmLabel: 'Block Dates',
    });
    if (!ok) return;

    setBusyKey('add-block');
    setBanner(null);
    setAppStatus('saving', 'Blocking busy dates…');

    try {
      const { data, error } = await supabase
        .from('vehicle_availability_blocks')
        .insert({
          vehicle_listing_id: targetVehicleId,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          reason: blockReason,
          notes: blockNotes.trim() || null,
          created_by: authUser.id,
        })
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      setBlocks((prev) => [...prev, data as VehicleAvailabilityBlockRecord]);
      setBlockNotes('');
      const msg = 'Blocked busy window on your public availability calendar.';
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Dates blocked');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to add availability block.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Block failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    const ok = await confirm({
      title: 'Remove Availability Block?',
      description: 'Re-open this blocked time window for online vehicle bookings?',
      confirmLabel: 'Remove Block',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyKey(`del-block-${blockId}`);
    setAppStatus('saving', 'Removing block…');
    try {
      const { error } = await supabase
        .from('vehicle_availability_blocks')
        .delete()
        .eq('id', blockId);
      if (error) throw new Error(error.message);
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setAppStatus('success', 'Block removed');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete block.',
      });
      setAppStatus('error', 'Delete failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleVerifyBookingOtp = async (
    booking: HydratedBookingRow,
    stage: 'start' | 'end'
  ) => {
    const entered = (otpInputs[booking.id] || '').replace(/\D/g, '').trim();
    if (entered.length !== 6) {
      setBanner({
        type: 'error',
        text: `Enter the 6-digit ${stage === 'start' ? 'Start' : 'End'} OTP from the customer.`,
      });
      return;
    }

    setBusyKey(`otp-${booking.id}`);
    setBanner(null);
    setAppStatus('saving', `Verifying ${stage} OTP…`);

    try {
      const { error } = await supabase.rpc('verify_vehicle_booking_otp', {
        p_booking_id: booking.id,
        p_stage: stage === 'start' ? 'pickup' : 'dropoff',
        p_otp: entered,
      });
      if (error) throw new Error(error.message);

      const nextStatus = stage === 'start' ? 'in_progress' : 'completed';
      setBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id ? { ...b, status: nextStatus } : b
        )
      );
      setOtpInputs((prev) => ({ ...prev, [booking.id]: '' }));
      const msg =
        stage === 'start'
          ? `Start OTP verified — ${booking.booking_code} is now In Progress.`
          : `End OTP verified — ${booking.booking_code} marked Completed!`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', stage === 'start' ? 'Trip started' : 'Trip completed');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'OTP verification failed.',
      });
      setAppStatus('error', 'OTP failed');
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-10 text-xs text-[var(--ps-text-muted)] gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
        <span>Loading vehicle listings &amp; schedule…</span>
      </div>
    );
  }

  return (
    <div
      data-testid="vehicle-fleet-calendar-manager"
      className="space-y-4 min-w-0 max-w-full overflow-x-clip text-xs text-[var(--ps-text)]"
    >
      {/* Internal tabs when used inside OwnerWorkspace */}
      {viewMode === 'both' && (
        <div className="flex items-center justify-between gap-2 min-w-0 max-w-full">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 pb-0.5">
            <button
              type="button"
              onClick={() => setInnerTab('listing')}
              className={`inline-flex h-8 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                activeView === 'listing'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
              }`}
            >
              <Car className="h-3.5 w-3.5 shrink-0" />
              <span>Vehicle Listings ({myListings.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setInnerTab('calendar')}
              className={`inline-flex h-8 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                activeView === 'calendar'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
              }`}
            >
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>Schedule &amp; Calendar ({bookings.length})</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void loadFleetData()}
            aria-label="Reload fleet schedule"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {banner && (
        <div
          className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{banner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-[11px] font-bold opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* VIEW 1: MY VEHICLE LISTING EDITOR                                 */}
      {/* ================================================================= */}
      {activeView === 'listing' && (
        <form
          onSubmit={handleSaveListing}
          className="space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                My Vehicle Listing
              </h2>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Publish your charter, taxi, or fixed-route vehicle to Explore
                with conflict-free advance booking.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text-muted)]">
                Quota: {myListings.length} /{' '}
                {maxVehicleListingsLimit < 0
                  ? 'Unlimited'
                  : maxVehicleListingsLimit}
              </span>
              {selectedListingId !== 'new' && (
                <Link
                  href={`/vehicles/${encodeURIComponent(selectedListingId)}`}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)]"
                >
                  <span>View Public Page</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CustomSelectModal
              label="Select Vehicle to Edit or Create New"
              options={listingSelectOptions}
              value={selectedListingId}
              onChange={handleSelectListing}
              testId="fleet-listing-selector"
            />
            <CustomSelectModal
              label="Vehicle Category *"
              options={vehicleTypeOptions}
              value={vehicleTypeId}
              onChange={setVehicleTypeId}
              placeholder="Choose vehicle type"
              testId="fleet-vehicle-type-select"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Listing Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Tuibong Stand Bolero 4WD Charter"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Stand Locality *
              </label>
              <input
                type="text"
                required
                value={standLocality}
                onChange={(e) => setStandLocality(e.target.value)}
                placeholder="e.g. Tuibong Bus Stand"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
              />
            </div>
          </div>

          {/* Quick Lamka Stand Coordinates Presets */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
              Quick Stand Pin Presets (Explore Map Pin):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {LAMKA_STAND_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setStandLocality(preset.label);
                    setLat(String(preset.lat));
                    setLng(String(preset.lng));
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-medium text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                >
                  <MapPin className="h-3 w-3 text-[var(--ps-accent)]" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          <MapCoordinatePicker
            mode="point"
            label="Stand / Boarding Map Coordinates"
            helperText="Pin your exact departure stand so passengers can navigate directly."
            coordinates={{
              lat: Number(lat) || activeHub?.center_lat || 24.3335,
              lng: Number(lng) || activeHub?.center_lng || 93.6978,
            }}
            onChangeCoordinates={(next) => {
              setLat(String(next.lat));
              setLng(String(next.lng));
            }}
            hubCenter={
              activeHub
                ? { lat: activeHub.center_lat, lng: activeHub.center_lng }
                : null
            }
            hubLabel={activeHub?.name}
            quickLocalities={LAMKA_STAND_PRESETS.map((p) => ({
              id: p.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              label: p.label,
              lat: p.lat,
              lng: p.lng,
            }))}
          />

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
              Description &amp; Terms
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Luggage capacity, route experience, night-halt rules, driver language…"
              className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] resize-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Vehicle Registration No.
              </label>
              <input
                type="text"
                value={vehicleRegNo}
                onChange={(e) => setVehicleRegNo(e.target.value.toUpperCase())}
                placeholder="e.g. MN-02-B-4821"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs uppercase text-[var(--ps-text)]"
              />
            </div>
            <div>
              <PhoneInputWithCountry
                id="fleet-operator-phone"
                label="Operator Phone"
                value={operatorPhone}
                onChange={(next) => setOperatorPhone(next)}
                variant="sm"
                testId="fleet-operator-phone-input"
              />
            </div>
            <div>
              <PhoneInputWithCountry
                id="fleet-operator-whatsapp"
                label="Operator WhatsApp"
                value={operatorWhatsapp}
                onChange={(next) => setOperatorWhatsapp(next)}
                variant="sm"
                testId="fleet-operator-whatsapp-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CustomSelectModal
              label="Booking Mode"
              options={BOOKING_MODE_OPTIONS}
              value={bookingMode}
              onChange={(v) => setBookingMode(v as VehicleBookingMode)}
              testId="fleet-booking-mode-select"
            />
            <CustomSelectModal
              label="Primary Pricing Model"
              options={PRICING_MODEL_OPTIONS}
              value={pricingModel}
              onChange={(v) => setPricingModel(v as VehiclePricingModel)}
              testId="fleet-pricing-model-select"
            />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Total Seats
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={totalSeats}
                  onChange={(e) => {
                    setTotalSeats(e.target.value);
                    if (!availableSeats) setAvailableSeats(e.target.value);
                  }}
                  className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Avail. Seats
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={availableSeats}
                  onChange={(e) => setAvailableSeats(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Advance %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={advancePercent}
                  onChange={(e) => setAdvancePercent(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                />
              </div>
            </div>
          </div>

          {/* Rates */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Hourly Rate (₹)
              </label>
              <input
                type="number"
                min={0}
                value={rateHourly}
                onChange={(e) => setRateHourly(e.target.value)}
                placeholder="e.g. 300"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Daily Charter (₹)
              </label>
              <input
                type="number"
                min={0}
                value={rateDaily}
                onChange={(e) => setRateDaily(e.target.value)}
                placeholder="e.g. 3500"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Per-Km Rate (₹)
              </label>
              <input
                type="number"
                min={0}
                value={ratePerKm}
                onChange={(e) => setRatePerKm(e.target.value)}
                placeholder="e.g. 22"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
              />
            </div>
          </div>

          {/* Fixed Routes Builder */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--ps-text)]">
                Fixed Routes ({fixedRoutes.length})
              </span>
              <span className="text-[10px] text-[var(--ps-text-muted)]">
                Optional point-to-point fares (e.g. Lamka ↔ Imphal)
              </span>
            </div>

            {fixedRoutes.length > 0 && (
              <div className="space-y-1.5">
                {fixedRoutes.map((r, idx) => (
                  <div
                    key={`${r.origin}-${r.destination}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5"
                  >
                    <span className="font-semibold text-[var(--ps-text)]">
                      {r.origin} ↔ {r.destination}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold tabular-nums text-[var(--ps-accent)]">
                        ₹{r.fare_inr}
                        {r.full_vehicle_fare_inr
                          ? ` · Full ₹${r.full_vehicle_fare_inr}`
                          : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setFixedRoutes((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="text-rose-500 hover:text-rose-600"
                        aria-label="Remove route"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 border-b border-[var(--ps-border)] pb-2.5">
              <CustomSelectModal
                label="Origin Hub"
                options={hubOptions}
                value={originHubName}
                onChange={(val) => {
                  setOriginHubName(val);
                  setRouteOrigin(val);
                }}
              />
              <div className="space-y-1">
                <span className="block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Served Destination Hubs
                </span>
                <div className="flex flex-wrap gap-1">
                  {hubOptions.map((h) => {
                    const active = destHubNames.includes(h.value);
                    return (
                      <button
                        key={h.value}
                        type="button"
                        onClick={() => {
                          setDestHubNames((prev) =>
                            prev.includes(h.value)
                              ? prev.filter((item) => item !== h.value)
                              : [...prev, h.value]
                          );
                          setRouteDest(h.value);
                        }}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                          active
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]'
                            : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {active ? '✓ ' : '+ '}
                        {h.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
              <input
                type="text"
                value={routeOrigin}
                onChange={(e) => setRouteOrigin(e.target.value)}
                placeholder="Origin"
                className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
              />
              <input
                type="text"
                value={routeDest}
                onChange={(e) => setRouteDest(e.target.value)}
                placeholder="Destination"
                className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
              />
              <input
                type="text"
                value={routeDepartureTime}
                onChange={(e) => setRouteDepartureTime(e.target.value)}
                placeholder="Dep. e.g. 06:30 AM"
                className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
              />
              <input
                type="number"
                value={routeFare}
                onChange={(e) => setRouteFare(e.target.value)}
                placeholder="Fare ₹"
                className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs"
              />
              <input
                type="number"
                value={routeFullFare}
                onChange={(e) => setRouteFullFare(e.target.value)}
                placeholder="Full Car ₹ (opt)"
                className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleAddFixedRoute}
                className="col-span-2 sm:col-span-1 inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[var(--ps-accent)] px-2.5 text-xs font-bold text-[var(--ps-accent-fg)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Toggles + Features */}
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={withDriver}
                onChange={(e) => setWithDriver(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--ps-accent)]"
              />
              <span>With Driver (uncheck for Self-Drive)</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={isActiveListing}
                onChange={(e) => setIsActiveListing(e.target.checked)}
                className="h-4 w-4 rounded accent-emerald-600"
              />
              <span>Visible &amp; Bookable on Explore</span>
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
              Vehicle Features
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_SUGGESTIONS.map((feat) => {
                const active = features.includes(feat);
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() =>
                      setFeatures((prev) =>
                        prev.includes(feat)
                          ? prev.filter((f) => f !== feat)
                          : [...prev, feat]
                      )
                    }
                    className={`h-7 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    {active ? '✓ ' : '+ '}
                    {feat}
                  </button>
                );
              })}
              <div className="inline-flex items-center gap-1">
                <input
                  type="text"
                  value={customFeature}
                  onChange={(e) => setCustomFeature(e.target.value)}
                  placeholder="Custom…"
                  className="h-7 w-24 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = customFeature.trim();
                    if (clean && !features.includes(clean)) {
                      setFeatures((prev) => [...prev, clean]);
                      setCustomFeature('');
                    }
                  }}
                  className="inline-flex h-7 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Photo & 360 Interior Upload */}
          <QuickImageUploadField
            label="Primary Vehicle Cover Photo"
            value={thumbnailUrl}
            entityType="listing_gallery"
            entityId={selectedListingId !== 'new' ? selectedListingId : undefined}
            hubId={activeHub?.id}
            onUploaded={(nextUrl) => {
              setThumbnailUrl(nextUrl);
              if (nextUrl && !imageUrls.includes(nextUrl)) {
                setImageUrls((prev) => [nextUrl, ...prev]);
              }
            }}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--ps-text)]">
                  Vehicle Photos ({imageUrls.length})
                </span>
                <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-[var(--ps-accent)] px-2.5 text-[11px] font-bold text-[var(--ps-accent-fg)]">
                  {isUploadingMedia ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3 w-3" />
                  )}
                  <span>Upload</span>
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) =>
                      void handleUploadPhoto(e.target.files, 'gallery')
                    }
                  />
                </label>
              </div>
              {imageUrls.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {imageUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--ps-border)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveRemoteMediaUrl(url)}
                        alt={`Vehicle photo ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setImageUrls((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="absolute right-0.5 top-0.5 rounded bg-black/70 p-0.5 text-white"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 font-semibold text-[var(--ps-text)]">
                  <Compass className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span>360° Interior Panorama (Opt.)</span>
                </span>
                <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold">
                  <ImagePlus className="h-3 w-3" />
                  <span>Upload 360°</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) =>
                      void handleUploadPhoto(e.target.files, 'panorama')
                    }
                  />
                </label>
              </div>
              <input
                type="url"
                value={panoramaUrl}
                onChange={(e) => setPanoramaUrl(e.target.value)}
                placeholder="Or paste 2:1 equirectangular panorama URL"
                className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px]"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={busyKey === 'save-listing'}
              data-testid="fleet-save-listing-btn"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-50"
            >
              {busyKey === 'save-listing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>
                {selectedListingId === 'new'
                  ? 'Publish Vehicle Listing'
                  : 'Save Listing Changes'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* ================================================================= */}
      {/* VIEW 2: SCHEDULE, BOOKINGS OTP & BLOCK BUSY DATES                 */}
      {/* ================================================================= */}
      {activeView === 'calendar' && (
        <div className="space-y-4">
          {/* 1-Tap Block Busy Dates Card */}
          <form
            onSubmit={handleAddBlock}
            className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
                  <CalendarOff className="h-4 w-4 text-amber-500" />
                  <span>Block Busy Dates</span>
                </h2>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Instantly block offline walk-in trips, servicing, or personal
                  days so online customers cannot double-book.
                </p>
              </div>
            </div>

            {myListings.length === 0 ? (
              <p className="text-xs text-[var(--ps-text-muted)]">
                Create your vehicle listing first to manage its calendar blocks.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {myListings.length > 1 && (
                    <CustomSelectModal
                      label="Vehicle"
                      options={blockVehicleOptions}
                      value={blockListingId || myListings[0].id}
                      onChange={setBlockListingId}
                      testId="block-vehicle-select"
                    />
                  )}
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      Start Date &amp; Time
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={blockStart}
                      onChange={(e) => setBlockStart(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      End Date &amp; Time
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                  </div>
                  <CustomSelectModal
                    label="Reason"
                    options={BLOCK_REASON_OPTIONS}
                    value={blockReason}
                    onChange={(v) =>
                      setBlockReason(
                        v as 'offline_booking' | 'maintenance' | 'personal'
                      )
                    }
                    testId="block-reason-select"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={blockNotes}
                    onChange={(e) => setBlockNotes(e.target.value)}
                    placeholder="Optional note (e.g. Imphal airport pickup for Pu Thang)"
                    className="h-9 flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                  <button
                    type="submit"
                    disabled={busyKey === 'add-block'}
                    data-testid="fleet-add-block-btn"
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {busyKey === 'add-block' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CalendarOff className="h-3.5 w-3.5" />
                    )}
                    <span>Block Busy Dates</span>
                  </button>
                </div>
              </>
            )}

            {/* Active Blocks List */}
            {blocks.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[var(--ps-border)]">
                <p className="text-[11px] font-bold text-[var(--ps-text-muted)]">
                  Active Calendar Blocks ({blocks.length})
                </p>
                {blocks.map((blk) => {
                  const veh = myListings.find(
                    (l) => l.id === blk.vehicle_listing_id
                  );
                  return (
                    <div
                      key={blk.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--ps-text)] truncate">
                          {blk.reason.replace(/_/g, ' ')} ·{' '}
                          <span className="font-normal text-[var(--ps-text-muted)]">
                            {veh?.title || 'Vehicle'}
                          </span>
                        </p>
                        <p className="font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                          {new Date(blk.start_time).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          →{' '}
                          {new Date(blk.end_time).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {blk.notes ? ` · ${blk.notes}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busyKey === `del-block-${blk.id}`}
                        onClick={() => void handleDeleteBlock(blk.id)}
                        aria-label="Delete calendar block"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                      >
                        {busyKey === `del-block-${blk.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </form>

          {/* Upcoming Confirmed & Pending Vehicle Bookings */}
          <section className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
              <div>
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Scheduled Vehicle Bookings ({bookings.length})
                </h2>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Verify Start OTP on pickup and End OTP on dropoff to track
                  trip completion and driver balance collection.
                </p>
              </div>
            </div>

            {bookings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-[var(--ps-text-muted)]">
                No scheduled vehicle bookings yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {bookings.map((bk) => {
                  const stage: 'start' | 'end' | null =
                    bk.status === 'confirmed'
                      ? 'start'
                      : bk.status === 'in_progress'
                        ? 'end'
                        : null;
                  const isBusy = busyKey === `otp-${bk.id}`;
                  return (
                    <article
                      key={bk.id}
                      data-testid={`vehicle-booking-card-${bk.booking_code}`}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-extrabold text-[var(--ps-text)]">
                              {bk.booking_code}
                            </span>
                            <span className="text-[11px] font-bold text-[var(--ps-accent)]">
                              {bk.status.replace(/_/g, ' ')}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                              <Users className="h-3 w-3" />
                              {bk.booking_mode === 'full_vehicle'
                                ? 'Full Vehicle'
                                : `${bk.seats_booked} Seat(s)`}
                            </span>
                          </div>
                          <p className="font-semibold text-[var(--ps-text)]">
                            {bk.vehicle_title}
                          </p>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            {bk.pickup_location}
                            {bk.dropoff_location
                              ? ` → ${bk.dropoff_location}`
                              : ''}
                          </p>
                          <p className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                            <Clock className="h-3 w-3" />
                            {new Date(bk.start_time).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            –{' '}
                            {new Date(bk.end_time).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>

                        <div className="text-right space-y-1 shrink-0">
                          <p className="font-mono text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
                            ₹{bk.total_fare_inr.toLocaleString('en-IN')}
                          </p>
                          <div className="flex flex-col items-end gap-1">
                            <span className="inline-flex items-center rounded-md border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                              {bk.status === 'soft_hold' ||
                              bk.status === 'pending_payment_confirm'
                                ? `Advance Pending: ₹${bk.advance_amount_inr.toLocaleString('en-IN')}`
                                : `Advance Paid: ₹${bk.advance_amount_inr.toLocaleString('en-IN')}`}
                            </span>
                            <span className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-700 dark:text-amber-300">
                              Balance to Collect: ₹
                              {bk.balance_due_inr.toLocaleString('en-IN')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] pt-2 text-[11px]">
                        <span className="text-[var(--ps-text-muted)]">
                          Customer:{' '}
                          <strong className="text-[var(--ps-text)]">
                            {bk.customer_name}
                          </strong>
                        </span>
                        {bk.customer_phone && (
                          <a
                            href={`tel:${bk.customer_phone}`}
                            className="inline-flex items-center gap-1 font-mono font-semibold text-[var(--ps-accent)] hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            {bk.customer_phone}
                          </a>
                        )}
                      </div>

                      {stage && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-lg border border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/5 p-2.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ps-text)] shrink-0">
                            <KeyRound className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                            <span>
                              {stage === 'start' ? 'Start OTP' : 'End OTP'}
                            </span>
                          </div>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={otpInputs[bk.id] || ''}
                            onChange={(e) =>
                              setOtpInputs((prev) => ({
                                ...prev,
                                [bk.id]: e.target.value.replace(/\D/g, ''),
                              }))
                            }
                            placeholder="6-digit customer OTP"
                            className="h-8 flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-xs font-bold tracking-widest"
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleVerifyBookingOtp(bk, stage)
                            }
                            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {stage === 'start' ? 'Start Trip' : 'Finish Trip'}
                            </span>
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

export default VehicleFleetCalendarManager;
