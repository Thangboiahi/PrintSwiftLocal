'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import {
  AlertCircle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bike,
  Car,
  CarTaxiFront,
  Check,
  CheckCircle2,
  Copy,
  Crosshair,
  ExternalLink,
  Flame,
  Info,
  Loader2,
  LocateFixed,
  MapPin,
  Package,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/store';
import { clearAppStatus, setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/supabase/storage';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { OrderTrackerModal } from '@/components/pickndrop/OrderTrackerModal';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { ModulePausedGuard } from '@/components/shared/ModulePausedGuard';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import {
  CONTAINER_TYPE_OPTIONS,
  FALLBACK_VEHICLE_TYPES,
  INSTRUCTION_QUICK_CHIPS,
  LAMKA_QUICK_LANDMARKS,
  SERVICE_MODE_META,
  type DeliveryContainerType,
  type DeliveryServiceMode,
  type DeliveryTripType,
  type ManualUpiPaymentInstructions,
  type PickNDropPoint,
  type QuoteApiResponse,
  type VehicleTypeItem,
} from '@/lib/pick-n-drop/types';
import {
  patchPickNDropDraft,
  readPickNDropDraft,
} from '@/lib/pick-n-drop/draft-context';

export interface PickNDropPanelProps {
  isActive?: boolean;
  onBackToListings: () => void;
  pickup: PickNDropPoint | null;
  dropoff: PickNDropPoint | null;
  onChangePickup: (point: PickNDropPoint | null) => void;
  onChangeDropoff: (point: PickNDropPoint | null) => void;
  activePinTarget: 'pickup' | 'dropoff' | null;
  onSelectPinTarget: (target: 'pickup' | 'dropoff' | null) => void;
  onTripTypeChange?: (tripType: DeliveryTripType) => void;
  showPanelHeader?: boolean;
  initialServiceMode?: DeliveryServiceMode;
  initialTripType?: DeliveryTripType;
  initialVehicleSlug?: string | null;
  routeMetrics?: { distanceKm: number; durationMin: number } | null;
  showReturnToFullFormLink?: boolean;
  attachedItem?: { id?: string; title: string; qty?: number } | null;
  onDismissAttachedItem?: () => void;
  initialNotes?: string;
  onDraftMetaChange?: (meta: {
    serviceType: DeliveryServiceMode;
    tripMode: DeliveryTripType;
    vehicleTypeSlug: string | null;
  }) => void;
}

const DEFAULT_MODES_BY_SLUG: Record<string, DeliveryServiceMode[]> = {
  cycle_rickshaw: ['parcel', 'gas'],
  two_wheeler: ['parcel', 'passenger', 'gas'],
  e_rickshaw: ['parcel', 'passenger', 'gas'],
  mini_van: ['parcel', 'passenger'],
  pickup_truck: ['parcel', 'gas'],
};

function normalizeSupportedModes(
  raw: unknown,
  slug: string
): DeliveryServiceMode[] {
  if (Array.isArray(raw)) {
    const valid = raw.filter(
      (m): m is DeliveryServiceMode =>
        m === 'parcel' || m === 'passenger' || m === 'gas'
    );
    if (valid.length > 0) return valid;
  }
  return DEFAULT_MODES_BY_SLUG[slug] || ['parcel', 'passenger', 'gas'];
}

function VehicleGlyph({
  icon,
  className = 'h-3.5 w-3.5',
}: {
  icon?: string | null;
  className?: string;
}) {
  switch (icon) {
    case 'bike':
      return <Bike className={className} />;
    case 'car-taxi-front':
      return <CarTaxiFront className={className} />;
    case 'car':
      return <Car className={className} />;
    default:
      return <Truck className={className} />;
  }
}

export function PickNDropPanel({
  isActive = true,
  onBackToListings,
  pickup,
  dropoff,
  onChangePickup,
  onChangeDropoff,
  activePinTarget,
  onSelectPinTarget,
  onTripTypeChange,
  showPanelHeader = false,
  initialServiceMode,
  initialTripType,
  initialVehicleSlug,
  routeMetrics = null,
  showReturnToFullFormLink = false,
  attachedItem = null,
  onDismissAttachedItem,
  initialNotes = '',
  onDraftMetaChange,
}: PickNDropPanelProps) {
  const { user: authUser } = useAuth();
  const authUserId = authUser?.id || null;
  const { activeHub, hubVehicleRates, hubLocalities } = useAppConfig();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubCenterLat = activeHub?.center_lat ?? 24.3335;
  const activeHubCenterLng = activeHub?.center_lng ?? 93.6978;
  const activeHubServiceRadiusKm = Number(activeHub?.service_radius_km || 25);

  // Step state: 'configure' -> 'upi_checkout'
  const [step, setStep] = useState<'configure' | 'upi_checkout'>('configure');

  // Phase 60-C: 3 Service Modes ('parcel' | 'passenger' | 'gas')
  const [serviceMode, setServiceMode] = useState<DeliveryServiceMode>(() => {
    if (initialServiceMode) return initialServiceMode;
    return readPickNDropDraft().serviceType;
  });
  const [tripType, setTripType] = useState<DeliveryTripType>(() => {
    if (initialTripType) return initialTripType;
    return readPickNDropDraft().tripMode;
  });

  // Address text & suggestion dropdown state
  const [pickupQuery, setPickupQuery] = useState(pickup?.label || '');
  const [dropoffQuery, setDropoffQuery] = useState(dropoff?.label || '');
  const [focusedField, setFocusedField] = useState<
    'pickup' | 'dropoff' | null
  >(null);
  const [isLocatingPoint, setIsLocatingPoint] = useState<
    'pickup' | 'dropoff' | null
  >(null);

  // Vehicle Pool & Live Quotes
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeItem[]>(
    FALLBACK_VEHICLE_TYPES
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    FALLBACK_VEHICLE_TYPES[0].id
  );
  const [vehicleQuotes, setVehicleQuotes] = useState<
    Record<string, QuoteApiResponse>
  >({});
  const [isQuoting, setIsQuoting] = useState(false);

  // Mode-specific fields
  const [containerType, setContainerType] =
    useState<DeliveryContainerType>('small_box');
  const [passengerCount, setPassengerCount] = useState<number>(1);
  const [bookingForSomeoneElse, setBookingForSomeoneElse] = useState(false);
  const [cylinderCount, setCylinderCount] = useState<number>(1);

  // Contacts, Unified Instructions & Waiver
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [declaredValueInr, setDeclaredValueInr] = useState('');
  const [instructions, setInstructions] = useState('');
  const [waiverAccepted, setWaiverAccepted] = useState(false);

  // Pass V11-A: Auto-prefill notes when launched with attachedItem / initialNotes
  useEffect(() => {
    const cleanTitle = attachedItem?.title?.trim() || '';
    const qtySuffix =
      attachedItem?.qty && attachedItem.qty > 1 ? ` × ${attachedItem.qty}` : '';
    const noteExtra = initialNotes?.trim() || '';
    if (!cleanTitle && !noteExtra) return;
    const composed = cleanTitle
      ? `Pickup Item: ${cleanTitle}${qtySuffix}${noteExtra ? ` — ${noteExtra}` : ''}`
      : noteExtra;
    queueMicrotask(() => {
      setInstructions((prev) => (prev.trim().length > 0 ? prev : composed));
    });
  }, [attachedItem?.id, attachedItem?.title, attachedItem?.qty, initialNotes]);

  // Order creation & Manual UPI Checkout state
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] =
    useState<ManualUpiPaymentInstructions | null>(null);
  const [upiUtrRef, setUpiUtrRef] = useState('');
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [isSubmittingUtr, setIsSubmittingUtr] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // Active Order Tracker modal state
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [activeOrderCount, setActiveOrderCount] = useState<number>(0);

  // Phase 63-B: Universal Payment Modal state
  const [universalIntent, setUniversalIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [universalUpi, setUniversalUpi] = useState<{
    upiId: string;
    upiPayeeName: string;
  }>({
    upiId: 'ddoodle.escrow@upi',
    upiPayeeName: 'DD oodle Escrow',
  });
  const [isUniversalPaymentOpen, setIsUniversalPaymentOpen] = useState(false);

  // Sync text inputs when map tap updates pickup/dropoff coordinates externally
  useEffect(() => {
    if (pickup?.label) {
      queueMicrotask(() => setPickupQuery(pickup.label));
    } else if (!pickup) {
      queueMicrotask(() => setPickupQuery(''));
    }
  }, [pickup]);

  useEffect(() => {
    if (dropoff?.label) {
      queueMicrotask(() => setDropoffQuery(dropoff.label));
    } else if (!dropoff) {
      queueMicrotask(() => setDropoffQuery(''));
    }
  }, [dropoff]);

  useEffect(() => {
    onTripTypeChange?.(tripType);
  }, [tripType, onTripTypeChange]);

  // Pass V3-B: Hydrate vehicle slug from draft or URL prop when vehicleTypes load
  useEffect(() => {
    const targetSlug = initialVehicleSlug || readPickNDropDraft().vehicleTypeSlug;
    if (!targetSlug) return;
    const match = vehicleTypes.find(
      (vt) => vt.slug === targetSlug || vt.id === targetSlug
    );
    if (match) {
      queueMicrotask(() => setSelectedVehicleId(match.id));
    }
  }, [initialVehicleSlug, vehicleTypes]);

  // Pass V3-B: Keep shared cross-page draft synced with serviceMode, tripType & vehicle
  useEffect(() => {
    const matched = vehicleTypes.find((vt) => vt.id === selectedVehicleId);
    const vehicleSlug = matched?.slug || null;
    patchPickNDropDraft({
      serviceType: serviceMode,
      tripMode: tripType,
      vehicleTypeSlug: vehicleSlug,
    });
    onDraftMetaChange?.({
      serviceType: serviceMode,
      tripMode: tripType,
      vehicleTypeSlug: vehicleSlug,
    });
  }, [serviceMode, tripType, selectedVehicleId, vehicleTypes, onDraftMetaChange]);

  // Vehicles filtered dynamically by serviceMode
  const visibleVehicleTypes = useMemo(() => {
    const filtered = vehicleTypes.filter((vt) =>
      vt.supported_modes.includes(serviceMode)
    );
    return filtered.length > 0 ? filtered : vehicleTypes;
  }, [vehicleTypes, serviceMode]);

  const effectiveSelectedVehicleId = useMemo(() => {
    if (visibleVehicleTypes.some((v) => v.id === selectedVehicleId)) {
      return selectedVehicleId;
    }
    return visibleVehicleTypes[0]?.id || '';
  }, [visibleVehicleTypes, selectedVehicleId]);

  const handleSelectServiceMode = useCallback(
    (nextMode: DeliveryServiceMode) => {
      setServiceMode(nextMode);
      setFormError(null);
      if (nextMode === 'gas') {
        setTripType('two_way');
      }
      const matching = vehicleTypes.filter((vt) =>
        vt.supported_modes.includes(nextMode)
      );
      if (
        matching.length > 0 &&
        !matching.some((vt) => vt.id === selectedVehicleId)
      ) {
        setSelectedVehicleId(matching[0].id);
      }
    },
    [vehicleTypes, selectedVehicleId]
  );

  // Phase 68-B: Hydrate vehicleTypes from useAppConfig().hubVehicleRates (respecting is_enabled_in_hub)
  useEffect(() => {
    if (!Array.isArray(hubVehicleRates) || hubVehicleRates.length === 0) {
      return;
    }
    const enabledRates = hubVehicleRates.filter(
      (r) => r.is_enabled_in_hub !== false
    );
    if (enabledRates.length === 0) return;
    const mapped: VehicleTypeItem[] = enabledRates.map((row) => {
      const slug = String(row.slug);
      return {
        id: String(row.vehicle_type_id),
        slug,
        name: String(row.name),
        icon: row.icon ? String(row.icon) : null,
        base_fare_inr: Number(row.base_fare_inr),
        per_km_rate_inr: Number(row.per_km_rate_inr),
        wait_per_10min_inr: Number(row.wait_per_10min_inr),
        free_wait_minutes: Number(row.free_wait_minutes),
        two_way_multiplier: Number(row.two_way_multiplier),
        max_weight_kg: Number(row.max_weight_kg),
        max_dimensions: row.max_dimensions ? String(row.max_dimensions) : null,
        supported_modes: normalizeSupportedModes(row.supported_modes, slug),
        is_active: true,
      };
    });
    const existingSlugs = new Set(mapped.map((v) => v.slug || v.id));
    const reconciled = [
      ...mapped,
      ...FALLBACK_VEHICLE_TYPES.filter(
        (fb) => !existingSlugs.has(fb.slug) && !existingSlugs.has(fb.id)
      ),
    ].sort((a, b) => a.base_fare_inr - b.base_fare_inr);
    queueMicrotask(() => {
      setVehicleTypes(reconciled);
      setSelectedVehicleId((prev) =>
        reconciled.some((v) => v.id === prev) ? prev : reconciled[0].id
      );
    });
  }, [hubVehicleRates]);

  // Fetch live vehicle_types from Supabase (fallback if hubVehicleRates empty) + active customer order count
  useEffect(() => {
    if (!isActive) return;
    let active = true;

    async function loadInitialData() {
      if (!isSupabaseConfigured()) return;
      try {
        if (!Array.isArray(hubVehicleRates) || hubVehicleRates.length === 0) {
          const { data: vtRows } = await supabase
            .from('vehicle_types')
            .select('*')
            .eq('is_active', true)
            .order('base_fare_inr', { ascending: true });

          if (active && Array.isArray(vtRows) && vtRows.length > 0) {
            const normalized: VehicleTypeItem[] = vtRows.map((row) => {
              const slug = String(row.slug);
              return {
                id: String(row.id),
                slug,
                name: String(row.name),
                icon: row.icon ? String(row.icon) : null,
                base_fare_inr: Number(row.base_fare_inr),
                per_km_rate_inr: Number(row.per_km_rate_inr),
                wait_per_10min_inr: Number(row.wait_per_10min_inr),
                free_wait_minutes: Number(row.free_wait_minutes),
                two_way_multiplier: Number(row.two_way_multiplier),
                max_weight_kg: Number(row.max_weight_kg),
                max_dimensions: row.max_dimensions
                  ? String(row.max_dimensions)
                  : null,
                supported_modes: normalizeSupportedModes(
                  row.supported_modes,
                  slug
                ),
                is_active: Boolean(row.is_active),
              };
            });
            const normalizedSlugs = new Set(normalized.map((v) => v.slug || v.id));
            const mergedAllFive = [
              ...normalized,
              ...FALLBACK_VEHICLE_TYPES.filter(
                (fb) => !normalizedSlugs.has(fb.slug) && !normalizedSlugs.has(fb.id)
              ),
            ].sort((a, b) => a.base_fare_inr - b.base_fare_inr);
            setVehicleTypes(mergedAllFive);
            setSelectedVehicleId((prev) =>
              mergedAllFive.some((v) => v.id === prev) ? prev : mergedAllFive[0].id
            );
          }
        }

        if (authUserId) {
          const { count } = await supabase
            .from('delivery_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', authUserId)
            .not('status', 'in', '("completed","cancelled")');

          if (active && typeof count === 'number') {
            setActiveOrderCount(count);
          }
        }
      } catch {
        // Keep fallback vehicle types if table isn't migrated yet
      }
    }

    queueMicrotask(() => {
      if (active) void loadInitialData();
    });

    return () => {
      active = false;
    };
  }, [isActive, authUserId, hubVehicleRates]);

  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;
  const dropoffLat = dropoff?.lat ?? null;
  const dropoffLng = dropoff?.lng ?? null;

  // Phase 68-B: Geofence distance check against activeHub.service_radius_km
  const geofenceWarning = useMemo(() => {
    const computeDistKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    };

    if (pickupLat !== null && pickupLng !== null) {
      const distA = computeDistKm(
        activeHubCenterLat,
        activeHubCenterLng,
        pickupLat,
        pickupLng
      );
      if (distA > activeHubServiceRadiusKm) {
        return `Pickup pin is ${distA.toFixed(1)} km from ${activeHubName} hub center (max service radius: ${activeHubServiceRadiusKm} km).`;
      }
    }
    if (dropoffLat !== null && dropoffLng !== null) {
      const distB = computeDistKm(
        activeHubCenterLat,
        activeHubCenterLng,
        dropoffLat,
        dropoffLng
      );
      if (distB > activeHubServiceRadiusKm) {
        return `Dropoff pin is ${distB.toFixed(1)} km from ${activeHubName} hub center (max service radius: ${activeHubServiceRadiusKm} km).`;
      }
    }
    return null;
  }, [
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    activeHubCenterLat,
    activeHubCenterLng,
    activeHubServiceRadiusKm,
    activeHubName,
  ]);

  // Live server-calculated quotes whenever A, B, tripType, serviceMode, containerType, or cylinderCount change
  useEffect(() => {
    if (
      !isActive ||
      pickupLat === null ||
      pickupLng === null ||
      dropoffLat === null ||
      dropoffLng === null ||
      visibleVehicleTypes.length === 0 ||
      Boolean(geofenceWarning)
    ) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const fetchQuotes = async () => {
        setIsQuoting(true);
        setAppStatus('routing', 'Calculating fare');
        try {
          const results = await Promise.all(
            visibleVehicleTypes.map(async (vt) => {
              const res = await fetch('/api/pick-n-drop/quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  hubId:
                    activeHubId && !activeHubId.startsWith('fallback-')
                      ? activeHubId
                      : undefined,
                  pickupLat,
                  pickupLng,
                  dropoffLat,
                  dropoffLng,
                  vehicleTypeId: vt.id,
                  tripType,
                  serviceMode,
                  containerType:
                    serviceMode === 'parcel' ? containerType : undefined,
                  cylinderCount:
                    serviceMode === 'gas' ? cylinderCount : undefined,
                }),
              });
              if (!res.ok) return null;
              const json = (await res.json()) as QuoteApiResponse;
              return { id: vt.id, quote: json };
            })
          );

          if (cancelled) return;
          const nextMap: Record<string, QuoteApiResponse> = {};
          for (const item of results) {
            if (item?.quote) {
              nextMap[item.id] = item.quote;
            }
          }
          setVehicleQuotes(nextMap);
        } catch {
          // Graceful degradation; cards still display base fare previews
        } finally {
          if (!cancelled) {
            setIsQuoting(false);
            clearAppStatus();
          }
        }
      };

      void fetchQuotes();
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isActive,
    activeHubId,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    tripType,
    serviceMode,
    containerType,
    cylinderCount,
    visibleVehicleTypes,
    geofenceWarning,
  ]);

  const activeQuote =
    pickup && dropoff && !geofenceWarning
      ? vehicleQuotes[effectiveSelectedVehicleId] || null
      : null;
  const activeBreakdown =
    activeQuote?.breakdown || activeQuote?.fare_breakdown || null;

  const hubLandmarkPool = useMemo<PickNDropPoint[]>(() => {
    const fromHub = hubLocalities
      .filter(
        (loc) =>
          loc.is_active &&
          loc.status === 'verified' &&
          typeof loc.lat === 'number' &&
          typeof loc.lng === 'number' &&
          Number.isFinite(loc.lat) &&
          Number.isFinite(loc.lng)
      )
      .map((loc) => ({
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        label: `${loc.display_name}, ${activeHubName}`,
      }));
    return fromHub.length > 0 ? fromHub : LAMKA_QUICK_LANDMARKS;
  }, [hubLocalities, activeHubName]);

  const filteredLandmarks = useMemo(() => {
    const query =
      focusedField === 'pickup'
        ? pickupQuery
        : focusedField === 'dropoff'
          ? dropoffQuery
          : '';
    const cleaned = query.trim().toLowerCase();
    if (!cleaned) return hubLandmarkPool.slice(0, 5);
    return hubLandmarkPool
      .filter((l) => l.label.toLowerCase().includes(cleaned))
      .slice(0, 5);
  }, [focusedField, pickupQuery, dropoffQuery, hubLandmarkPool]);

  const handleUseMyLocation = useCallback(
    (target: 'pickup' | 'dropoff') => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setFormError('Device geolocation is unavailable on this browser.');
        return;
      }
      setIsLocatingPoint(target);
      setFormError(null);
      setAppStatus('locating');

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const nextPt: PickNDropPoint = {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            label: `My Location (${pos.coords.latitude.toFixed(4)}°, ${pos.coords.longitude.toFixed(4)}°)`,
          };
          if (target === 'pickup') {
            onChangePickup(nextPt);
            setPickupQuery(nextPt.label);
          } else {
            onChangeDropoff(nextPt);
            setDropoffQuery(nextPt.label);
          }
          onSelectPinTarget(null);
          setIsLocatingPoint(null);
          clearAppStatus();
        },
        () => {
          setFormError(
            'Could not fetch GPS location. Tap the map or choose a Lamka landmark.'
          );
          setIsLocatingPoint(null);
          setAppStatus('error', 'Location unavailable');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    },
    [onChangePickup, onChangeDropoff, onSelectPinTarget]
  );

  const handleAppendInstructionChip = (chip: string) => {
    setInstructions((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip;
      if (trimmed.toLowerCase().includes(chip.toLowerCase())) {
        return trimmed;
      }
      return `${trimmed} • ${chip}`;
    });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!authUserId) {
      setFormError(
        'Please sign in to your account first to book a Pick N Drop trip.'
      );
      return;
    }

    if (!pickup || !dropoff) {
      setFormError(
        'Please set both Point A (Pickup) and Point B (Dropoff) on the map or from landmarks.'
      );
      return;
    }

    if (geofenceWarning) {
      setFormError(geofenceWarning);
      return;
    }

    if (!senderPhone.trim()) {
      setFormError('Your contact phone number is required.');
      return;
    }

    if (
      serviceMode === 'parcel' &&
      (!recipientName.trim() || !recipientPhone.trim())
    ) {
      setFormError(
        'Recipient name and recipient phone are required for Parcel deliveries.'
      );
      return;
    }

    if (!waiverAccepted) {
      setFormError(
        'Please confirm the safety & prohibited items waiver before proceeding.'
      );
      return;
    }

    setIsSubmittingOrder(true);
    setAppStatus('saving', 'Creating order');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        throw new Error('Please sign in to place a Pick N Drop order.');
      }

      const resolvedRecipientName =
        serviceMode === 'parcel'
          ? recipientName.trim()
          : serviceMode === 'passenger' && bookingForSomeoneElse
            ? recipientName.trim() || null
            : null;
      const resolvedRecipientPhone =
        serviceMode === 'parcel'
          ? recipientPhone.trim()
          : serviceMode === 'passenger' && bookingForSomeoneElse
            ? recipientPhone.trim() || null
            : null;

      const res = await fetch('/api/pick-n-drop/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          hubId:
            activeHubId && !activeHubId.startsWith('fallback-')
              ? activeHubId
              : undefined,
          serviceMode,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          pickupAddress: pickupQuery.trim() || pickup.label,
          senderPhone: senderPhone.trim(),
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          dropoffAddress: dropoffQuery.trim() || dropoff.label,
          recipientName: resolvedRecipientName,
          recipientPhone: resolvedRecipientPhone,
          vehicleTypeId: effectiveSelectedVehicleId,
          tripType,
          containerType: serviceMode === 'parcel' ? containerType : null,
          passengerCount: serviceMode === 'passenger' ? passengerCount : 1,
          cylinderCount: serviceMode === 'gas' ? cylinderCount : 1,
          instructions: instructions.trim() || null,
          declaredValueInr:
            serviceMode === 'parcel' && declaredValueInr
              ? Number(declaredValueInr)
              : 0,
          prohibitedItemsWaiver: true,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        order?: { id: string; order_code: string };
        payment_instructions?: ManualUpiPaymentInstructions;
      };

      if (!res.ok || !payload.order?.id || !payload.payment_instructions) {
        throw new Error(payload.error || 'Unable to create delivery order.');
      }

      setCreatedOrderId(payload.order.id);
      setPaymentInfo(payload.payment_instructions);
      onSelectPinTarget(null);
      setActiveOrderCount((c) => c + 1);

      // Create unified payment intent and launch UniversalPaymentModal
      let openedUniversal = false;
      try {
        const intentRes = await fetch('/api/payments/create-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            purpose: 'pick_n_drop',
            referenceId: payload.order.id,
            hubId:
              activeHubId && !activeHubId.startsWith('fallback-')
                ? activeHubId
                : undefined,
          }),
        });
        const intentPayload = (await intentRes.json().catch(() => ({}))) as {
          intent?: PaymentIntentRecord;
          upi_id?: string;
          upi_payee_name?: string;
        };
        if (intentRes.ok && intentPayload.intent) {
          setUniversalIntent(intentPayload.intent);
          setUniversalUpi({
            upiId:
              intentPayload.upi_id ||
              payload.payment_instructions.upi_id ||
              'ddoodle.escrow@upi',
            upiPayeeName:
              intentPayload.upi_payee_name ||
              payload.payment_instructions.payee_name ||
              'DD oodle Escrow',
          });
          setIsUniversalPaymentOpen(true);
          openedUniversal = true;
        }
      } catch {
        // Fall back to inline UPI checkout if intent endpoint unavailable
      }

      if (!openedUniversal) {
        setStep('upi_checkout');
      }

      setAppStatus('success', 'Order created — complete UPI payment');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('printswift:pnd-orders-updated'));
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to create delivery order.';
      setFormError(msg);
      setAppStatus('error', 'Order failed');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleSubmitUpiPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdOrderId || !paymentInfo) return;
    setFormError(null);

    const cleanedUtr = upiUtrRef.trim();
    if (!/^[A-Za-z0-9]{12,24}$/.test(cleanedUtr)) {
      setFormError(
        'Please enter your valid 12-digit UPI UTR reference number (no spaces).'
      );
      return;
    }

    setIsSubmittingUtr(true);
    setAppStatus('uploading', 'Submitting UPI proof');

    try {
      let proofPath: string | null = null;
      if (paymentProofFile) {
        const uploaded = await uploadImage(paymentProofFile, {
          folder: 'payments',
          entityId: createdOrderId,
        });
        proofPath = uploaded.publicUrl;
      }

      const { error: txError } = await supabase
        .from('delivery_transactions')
        .insert({
          order_id: createdOrderId,
          tx_type: 'upi_payment',
          amount_inr: paymentInfo.amount_inr,
          upi_utr_ref: cleanedUtr,
          payment_proof_path: proofPath,
          recorded_by: authUserId,
          notes: `Prepaid UPI payment submitted for ${paymentInfo.order_code}`,
        });

      if (txError) throw new Error(txError.message);

      const { error: updateErr } = await supabase
        .from('delivery_orders')
        .update({ status: 'payment_submitted' })
        .eq('id', createdOrderId);

      if (updateErr) throw new Error(updateErr.message);

      setAppStatus('success', 'Payment submitted');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('printswift:pnd-orders-updated'));
      }

      setStep('configure');
      setUpiUtrRef('');
      setPaymentProofFile(null);
      setIsTrackerOpen(true);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Failed to submit UPI payment reference.'
      );
      setAppStatus('error', 'Submission failed');
    } finally {
      setIsSubmittingUtr(false);
    }
  };

  const handleCopyUpiId = () => {
    if (!paymentInfo?.upi_id) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(paymentInfo.upi_id);
    }
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 1800);
  };

  return (
    <>
      <ModulePausedGuard module="pick_n_drop" compact>
      <div
        data-testid="pick-n-drop-panel"
        className="w-full space-y-2.5 text-xs"
      >
        {/* Optional Standalone Header (when rendered outside DiscoveryWorkspace header) */}
        {showPanelHeader ? (
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--ps-border)]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                <Package className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xs font-bold text-[var(--ps-text)]">
                  Pick N Drop
                </h2>
                <p className="truncate text-[10px] text-[var(--ps-text-muted)]">
                  {SERVICE_MODE_META[serviceMode].description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="pnd-open-my-orders-btn"
                onClick={() => setIsTrackerOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                <span>Orders</span>
                {activeOrderCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white tabular-nums">
                    {activeOrderCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={onBackToListings}
                aria-label="Back to Listings"
                data-testid="pnd-panel-back-btn"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                <ArrowLeft className="h-3 w-3" />
                <span>Listings</span>
              </button>
            </div>
          </div>
        ) : (
          /* Compact docked sub-bar inside Listings panel */
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-medium text-[var(--ps-text-muted)]">
              {step === 'upi_checkout'
                ? 'Manual UPI Prepaid Escrow'
                : SERVICE_MODE_META[serviceMode].description}
            </span>
            <button
              type="button"
              data-testid="pnd-open-my-orders-btn"
              onClick={() => setIsTrackerOpen(true)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              <span>My Orders</span>
              {activeOrderCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white tabular-nums">
                  {activeOrderCount}
                </span>
              )}
            </button>
          </div>
        )}

        {showReturnToFullFormLink && routeMetrics && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1.5">
            <span
              data-testid="pnd-live-route-metrics"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums"
            >
              <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>
                {routeMetrics.distanceKm.toFixed(1)} km · ~
                {routeMetrics.durationMin} min road
              </span>
            </span>
          </div>
        )}

        {attachedItem?.title && (
          <div
            data-testid="pnd-attached-item-pill"
            className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 px-2.5 py-1.5 text-[11px]"
          >
            <span className="flex items-center gap-1.5 min-w-0 font-semibold text-[var(--ps-text)]">
              <Package
                className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
              <span className="truncate">
                Pickup Item: <strong>{attachedItem.title}</strong>
                {attachedItem.qty && attachedItem.qty > 1
                  ? ` × ${attachedItem.qty}`
                  : ''}
              </span>
            </span>
            {onDismissAttachedItem && (
              <button
                type="button"
                onClick={onDismissAttachedItem}
                aria-label="Dismiss attached item"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {pickup && !dropoff && (
          <div
            data-testid="pnd-prompt-dropoff-hint"
            className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/8 px-2.5 py-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-300"
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Pickup locked — enter or tap Pin B for Dropoff to get instant fare.
            </span>
          </div>
        )}

        {geofenceWarning && (
          <div
            role="alert"
            data-testid="pnd-geofence-warning-banner"
            className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1">{geofenceWarning}</span>
          </div>
        )}

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{formError}</span>
            <button
              type="button"
              onClick={() => setFormError(null)}
              className="rounded p-0.5 hover:bg-black/5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {step === 'configure' ? (
          <form onSubmit={handleCreateOrder} className="space-y-2.5">
            {/* 3-TAB SERVICE MODE SEGMENTED CONTROL (Parcel | Ride (Taxi) | LPG Gas) */}
            <div
              role="tablist"
              aria-label="Pick N Drop service mode"
              data-tour="pnd-service-mode"
              className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1"
            >
              {(
                [
                  { id: 'parcel', label: 'Parcel', icon: Package },
                  { id: 'passenger', label: 'Ride (Taxi)', icon: CarTaxiFront },
                  { id: 'gas', label: 'LPG Gas', icon: Flame },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = serviceMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`pnd-mode-${tab.id}`}
                    onClick={() => handleSelectServiceMode(tab.id)}
                    className={`flex h-8 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* POINT A (PICKUP) & POINT B (DROPOFF) */}
            <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
              {/* Point A */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] text-white">
                      A
                    </span>
                    Pickup
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleUseMyLocation('pickup')}
                      disabled={isLocatingPoint === 'pickup'}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1.5 text-[10px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      {isLocatingPoint === 'pickup' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <LocateFixed className="h-3 w-3 text-emerald-600" />
                      )}
                      GPS
                    </button>
                    <button
                      type="button"
                      data-testid="pnd-pin-pickup-btn"
                      onClick={() =>
                        onSelectPinTarget(
                          activePinTarget === 'pickup' ? null : 'pickup'
                        )
                      }
                      className={`inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold transition-colors ${
                        activePinTarget === 'pickup'
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <Crosshair className="h-3 w-3" />
                      {activePinTarget === 'pickup' ? 'Tap Map…' : 'Pin A'}
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={pickupQuery}
                  onFocus={() => setFocusedField('pickup')}
                  onBlur={() => setTimeout(() => setFocusedField(null), 180)}
                  onChange={(e) => {
                    setPickupQuery(e.target.value);
                    if (pickup) {
                      onChangePickup({ ...pickup, label: e.target.value });
                    }
                  }}
                  placeholder={
                    serviceMode === 'gas'
                      ? 'Pickup house / empty cylinder location'
                      : 'Pickup address or tap Pin A on map'
                  }
                  className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                />
              </div>

              {/* Point B */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] text-white">
                      B
                    </span>
                    {serviceMode === 'gas' ? 'LPG Agency / Point B' : 'Dropoff'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleUseMyLocation('dropoff')}
                      disabled={isLocatingPoint === 'dropoff'}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1.5 text-[10px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      {isLocatingPoint === 'dropoff' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <LocateFixed className="h-3 w-3 text-indigo-600" />
                      )}
                      GPS
                    </button>
                    <button
                      type="button"
                      data-testid="pnd-pin-dropoff-btn"
                      onClick={() =>
                        onSelectPinTarget(
                          activePinTarget === 'dropoff' ? null : 'dropoff'
                        )
                      }
                      className={`inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold transition-colors ${
                        activePinTarget === 'dropoff'
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <Crosshair className="h-3 w-3" />
                      {activePinTarget === 'dropoff' ? 'Tap Map…' : 'Pin B'}
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={dropoffQuery}
                  onFocus={() => setFocusedField('dropoff')}
                  onBlur={() => setTimeout(() => setFocusedField(null), 180)}
                  onChange={(e) => {
                    setDropoffQuery(e.target.value);
                    if (dropoff) {
                      onChangeDropoff({ ...dropoff, label: e.target.value });
                    }
                  }}
                  placeholder={
                    serviceMode === 'gas'
                      ? 'LPG Gas agency / depot or tap Pin B'
                      : 'Dropoff address or tap Pin B on map'
                  }
                  className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                />
              </div>

              {/* Quick Hub Landmark Suggestions */}
              {focusedField && filteredLandmarks.length > 0 && (
                <div className="space-y-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-1.5">
                  <div className="px-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    {activeHubName} Landmarks (
                    {focusedField === 'pickup' ? 'Point A' : 'Point B'})
                  </div>
                  {filteredLandmarks.map((lm) => (
                    <button
                      key={lm.label}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (focusedField === 'pickup') {
                          onChangePickup(lm);
                          setPickupQuery(lm.label);
                        } else {
                          onChangeDropoff(lm);
                          setDropoffQuery(lm.label);
                        }
                        setFocusedField(null);
                      }}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      <MapPin className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                      <span className="truncate">{lm.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ONE-WAY vs TWO-WAY SEGMENTED TOGGLE (h-8) */}
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1">
              <button
                type="button"
                data-testid="pnd-trip-one-way"
                onClick={() => setTripType('one_way')}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tripType === 'one_way'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>One-Way</span>
                {activeQuote && (
                  <span className="font-mono text-[10px] opacity-90">
                    ₹{Math.round(activeQuote.one_way_fare_inr)}
                  </span>
                )}
              </button>
              <button
                type="button"
                data-testid="pnd-trip-two-way"
                onClick={() => setTripType('two_way')}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tripType === 'two_way'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                <span>Two-Way</span>
                {activeQuote && (
                  <span className="font-mono text-[10px] opacity-90">
                    ₹{Math.round(activeQuote.two_way_fare_inr)}
                  </span>
                )}
              </button>
            </div>

            {/* VEHICLE TYPE SELECTOR CARDS WITH DYNAMIC ONE-WAY / TWO-WAY PRICING */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[var(--ps-text)]">
                  Select Vehicle ({visibleVehicleTypes.length})
                </span>
                {isQuoting ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-accent)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Quoting live…
                  </span>
                ) : activeQuote ? (
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {activeQuote.distance_km} km •{' '}
                    {tripType === 'two_way' ? 'Return' : 'One-Way'}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--ps-text-muted)]">
                    Set A &amp; B for exact ₹ quote
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {visibleVehicleTypes.map((vt) => {
                  const isSelected = vt.id === effectiveSelectedVehicleId;
                  const quote = pickup && dropoff ? vehicleQuotes[vt.id] : null;
                  const previewFare = Math.round(
                    vt.base_fare_inr *
                      (tripType === 'two_way' ? vt.two_way_multiplier : 1)
                  );
                  return (
                    <button
                      key={vt.id}
                      type="button"
                      data-testid={`pnd-vehicle-card-${vt.slug}`}
                      onClick={() => setSelectedVehicleId(vt.id)}
                      className={`flex flex-col justify-between rounded-xl border p-2 text-left transition-all ${
                        isSelected
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 ring-1 ring-[var(--ps-accent)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-lg ${
                            isSelected
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'bg-[var(--ps-surface)] text-[var(--ps-text)]'
                          }`}
                        >
                          <VehicleGlyph icon={vt.icon} className="h-3.5 w-3.5" />
                        </span>
                        <span
                          data-testid={`pnd-vehicle-price-${vt.slug}`}
                          className="font-mono text-xs font-extrabold text-[var(--ps-text)]"
                        >
                          {quote
                            ? `₹${Math.round(quote.total_fare_inr)}`
                            : `₹${previewFare}+`}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <div className="truncate text-[11px] font-bold text-[var(--ps-text)]">
                          {vt.name}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)]">
                          {serviceMode === 'passenger'
                            ? `₹${vt.per_km_rate_inr}/km • ${vt.free_wait_minutes}m wait`
                            : `Up to ${vt.max_weight_kg} kg • ₹${vt.per_km_rate_inr}/km`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* MODE-SPECIFIC CONDITIONAL FIELDS */}
            {serviceMode === 'parcel' && (
              <div className="space-y-2">
                <CustomSelectModal
                  label="Container / Parcel Nature"
                  options={CONTAINER_TYPE_OPTIONS}
                  value={containerType}
                  onChange={(nextVal) =>
                    setContainerType(nextVal as DeliveryContainerType)
                  }
                  testId="pnd-container-select"
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <PhoneInputWithCountry
                      id="pnd-parcel-sender-phone"
                      label="Sender Phone"
                      required
                      value={senderPhone}
                      onChange={(next) => setSenderPhone(next)}
                      variant="sm"
                      testId="pnd-parcel-sender-phone"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                      Declared Value (₹ opt.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={declaredValueInr}
                      onChange={(e) => setDeclaredValueInr(e.target.value)}
                      placeholder="0"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                      Recipient Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Receiver full name"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <PhoneInputWithCountry
                      id="pnd-parcel-recipient-phone"
                      label="Recipient Phone"
                      required
                      value={recipientPhone}
                      onChange={(next) => setRecipientPhone(next)}
                      variant="sm"
                      testId="pnd-parcel-recipient-phone"
                    />
                  </div>
                </div>
              </div>
            )}

            {serviceMode === 'passenger' && (
              <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <PhoneInputWithCountry
                      id="pnd-passenger-sender-phone"
                      label="Your Contact Phone"
                      required
                      value={senderPhone}
                      onChange={(next) => setSenderPhone(next)}
                      variant="sm"
                      testId="pnd-passenger-sender-phone"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                      <Users className="h-3 w-3" />
                      Passengers
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {[1, 2, 3, 4].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          data-testid={`pnd-passenger-count-${cnt}`}
                          onClick={() => setPassengerCount(cnt)}
                          className={`h-8 rounded-lg border text-xs font-bold transition-colors ${
                            passengerCount === cnt
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          {cnt === 4 ? '4+' : cnt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-[11px] font-medium text-[var(--ps-text)]">
                  <input
                    type="checkbox"
                    checked={bookingForSomeoneElse}
                    onChange={(e) => setBookingForSomeoneElse(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--ps-border)] accent-[var(--ps-accent)]"
                  />
                  <span>Booking for someone else</span>
                </label>

                {bookingForSomeoneElse && (
                  <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        Rider Name (opt.)
                      </label>
                      <input
                        type="text"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        placeholder="Passenger name"
                        className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                      />
                    </div>
                    <div>
                      <PhoneInputWithCountry
                        id="pnd-passenger-rider-phone"
                        label="Rider Phone (opt.)"
                        value={recipientPhone}
                        onChange={(next) => setRecipientPhone(next)}
                        variant="sm"
                        testId="pnd-passenger-rider-phone"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {serviceMode === 'gas' && (
              <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <PhoneInputWithCountry
                      id="pnd-gas-sender-phone"
                      label="Your Phone"
                      required
                      value={senderPhone}
                      onChange={(next) => setSenderPhone(next)}
                      variant="sm"
                      testId="pnd-gas-sender-phone"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                      <Flame className="h-3 w-3 text-amber-500" />
                      Cylinder Count
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      {[1, 2].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          data-testid={`pnd-cylinder-count-${cnt}`}
                          onClick={() => setCylinderCount(cnt)}
                          className={`h-8 rounded-lg border px-2 text-[11px] font-bold transition-colors ${
                            cylinderCount === cnt
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          {cnt} {cnt === 1 ? 'Cylinder' : 'Cylinders'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-snug text-amber-800 dark:text-amber-200">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    Prepaid UPI covers transport only; LPG refill fee is paid
                    separately to agency.
                  </span>
                </div>
              </div>
            )}

            {/* UNIFIED INSTRUCTIONS & LANDMARKS FIELD + QUICK CHIPS */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                Instructions &amp; Landmarks
              </label>
              <textarea
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                data-testid="pnd-instructions-textarea"
                placeholder="Gate color, floor, shop landmark, or special handling notes…"
                className="w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)] resize-none"
              />
              <div className="flex flex-wrap gap-1">
                {INSTRUCTION_QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleAppendInstructionChip(chip)}
                    className="inline-flex h-6 items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-medium text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] transition-colors"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* LIVE FARE SUMMARY BAR WITH ONE-WAY vs TWO-WAY COMPARISON PILL */}
            {activeQuote && activeBreakdown && (
              <div
                data-testid="pnd-live-fare-summary"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[var(--ps-text-muted)]">
                    Base ₹{activeBreakdown.base_fare_inr} +{' '}
                    {activeQuote.distance_km} km
                    {tripType === 'two_way'
                      ? ` × ${activeBreakdown.two_way_multiplier}x`
                      : ''}
                    {activeBreakdown.container_surcharge_inr > 0
                      ? ` + ₹${activeBreakdown.container_surcharge_inr} cargo`
                      : ''}
                    {(activeBreakdown.cylinder_surcharge_inr ?? 0) > 0
                      ? ` + ₹${activeBreakdown.cylinder_surcharge_inr} cyl`
                      : ''}
                  </span>
                  <span className="font-mono text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                    ₹{activeQuote.total_fare_inr.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-semibold">
                    <span
                      className={
                        tripType === 'one_way'
                          ? 'text-emerald-700 dark:text-emerald-300 font-bold'
                          : 'text-[var(--ps-text-muted)]'
                      }
                    >
                      One-Way ₹{Math.round(activeQuote.one_way_fare_inr)}
                    </span>
                    <span className="text-[var(--ps-text-muted)]">vs</span>
                    <span
                      className={
                        tripType === 'two_way'
                          ? 'text-emerald-700 dark:text-emerald-300 font-bold'
                          : 'text-[var(--ps-text-muted)]'
                      }
                    >
                      Two-Way ₹{Math.round(activeQuote.two_way_fare_inr)}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--ps-text-muted)]">
                    {activeBreakdown.free_wait_minutes}m free wait • UPI Escrow
                  </span>
                </div>
              </div>
            )}

            {/* MANDATORY WAIVER */}
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2">
              <input
                type="checkbox"
                checked={waiverAccepted}
                onChange={(e) => setWaiverAccepted(e.target.checked)}
                data-testid="pnd-prohibited-waiver-checkbox"
                className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--ps-border)] accent-emerald-600"
              />
              <span className="text-[10px] leading-snug text-[var(--ps-text-muted)]">
                <strong className="text-[var(--ps-text)]">
                  <ShieldAlert className="mr-1 inline h-3 w-3 text-amber-500" />
                  Safety &amp; Prohibited Items Waiver:
                </strong>{' '}
                {serviceMode === 'passenger'
                  ? 'I agree to local ride safety rules and prepaid UPI escrow verification.'
                  : serviceMode === 'gas'
                    ? 'I confirm the domestic LPG cylinder valve is sealed safely with no leak.'
                    : 'I confirm this parcel contains no illegal, hazardous, explosive, or restricted contraband.'}
              </span>
            </label>

            {/* SUBMIT ORDER CTA */}
            <button
              type="submit"
              disabled={isSubmittingOrder}
              data-testid="pnd-create-order-btn"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {isSubmittingOrder ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Locking Quote &amp; Generating OTPs…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  {activeQuote
                    ? `Proceed to UPI Escrow (₹${activeQuote.total_fare_inr.toFixed(0)})`
                    : 'Proceed to UPI Escrow'}
                </>
              )}
            </button>
          </form>
        ) : (
          /* STEP 2: MANUAL UPI PREPAID CHECKOUT */
          paymentInfo && (
            <form onSubmit={handleSubmitUpiPayment} className="space-y-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Order Created • Pay via UPI Escrow
                    </div>
                    <div className="font-mono text-xs font-bold text-[var(--ps-text)]">
                      {paymentInfo.order_code}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-[var(--ps-text-muted)]">
                      Exact Total
                    </div>
                    <div className="font-mono text-base font-extrabold text-emerald-700 dark:text-emerald-300">
                      ₹{paymentInfo.amount_inr.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5">
                  <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border border-[var(--ps-border)] bg-white p-1.5 text-slate-900">
                    <QrCode className="h-10 w-10" />
                    <span className="text-[8px] font-bold uppercase">
                      UPI ESCROW
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                      {paymentInfo.payee_name}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <code className="truncate rounded bg-[var(--ps-bg)] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[var(--ps-text)]">
                        {paymentInfo.upi_id}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyUpiId}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 text-[10px] font-semibold text-[var(--ps-text)]"
                      >
                        {copiedUpi ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedUpi ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <a
                      href={paymentInfo.upi_uri}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--ps-accent)] px-2.5 text-[10px] font-bold text-[var(--ps-accent-fg)]"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open UPI App (₹{paymentInfo.amount_inr.toFixed(0)})
                    </a>
                  </div>
                </div>

                <ol className="list-decimal space-y-1 pl-4 text-[10px] text-[var(--ps-text-muted)]">
                  {paymentInfo.steps.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
                    12-Digit UPI UTR Reference Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={upiUtrRef}
                    onChange={(e) => setUpiUtrRef(e.target.value)}
                    placeholder="e.g. 432319827451"
                    data-testid="pnd-utr-input"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Payment Screenshot (Optional)
                  </label>
                  <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-medium text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)]">
                    <Upload className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {paymentProofFile
                        ? paymentProofFile.name
                        : 'Upload UPI receipt screenshot'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) =>
                        setPaymentProofFile(e.target.files?.[0] || null)
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSubmittingUtr}
                  data-testid="pnd-submit-utr-btn"
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isSubmittingUtr ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Submit UTR &amp; View OTPs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('configure');
                    setIsTrackerOpen(true);
                  }}
                  className="h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)]"
                >
                  Pay Later
                </button>
              </div>
            </form>
          )
        )}
      </div>
      </ModulePausedGuard>

      {/* Customer Order Tracker Modal */}
      <OrderTrackerModal
        mode="modal"
        isOpen={isTrackerOpen}
        initialOrderId={createdOrderId}
        onClose={() => setIsTrackerOpen(false)}
        onStartNewDelivery={() => {
          setIsTrackerOpen(false);
          setStep('configure');
        }}
      />

      {/* Phase 63-B: Universal Manual-to-Razorpay Payment Modal */}
      <UniversalPaymentModal
        open={isUniversalPaymentOpen}
        intent={universalIntent}
        upiId={universalUpi.upiId}
        upiPayeeName={universalUpi.upiPayeeName}
        title="Pick N Drop Escrow Payment"
        subtitle={
          paymentInfo?.order_code
            ? `Order ${paymentInfo.order_code} · Submit UTR to unlock Pickup & Dropoff OTPs`
            : 'Prepaid escrow protected until delivery OTP verification'
        }
        onSubmitted={(updatedIntent) => {
          setUniversalIntent(updatedIntent);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('printswift:pnd-orders-updated'));
          }
        }}
        onClose={() => {
          const hadSubmission =
            universalIntent?.status === 'pending_manual' ||
            universalIntent?.status === 'succeeded';
          setIsUniversalPaymentOpen(false);
          setStep('configure');
          if (hadSubmission || createdOrderId) {
            setIsTrackerOpen(true);
          }
        }}
      />
    </>
  );
}

export default PickNDropPanel;
