'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import {
  Building2,
  CheckCircle2,
  Clock,
  Crosshair,
  ExternalLink,
  ImagePlus,
  IndianRupee,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react';
import {
  LocalityCombobox,
  type LocalitySelection,
} from '@/components/ui/LocalityCombobox';
import { ConfirmActionModal } from '@/components/ui/ConfirmActionModal';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import { MediaUploader } from '@/components/shared/MediaUploader';
import type { ServiceHubRecord } from '@/lib/config/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { resolveCloudMapConfiguration } from '@/lib/map-cloud-styles';
import { useMapsAvailability } from '@/lib/maps-context';
import { normalizeClientPrintProfile } from '@/lib/print-orders/client-helpers';
import type {
  PrintCapabilities,
  PrintRateCard,
  PrintTurnaroundBadge,
} from '@/lib/print-orders/types';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { LatLngPoint } from '@/lib/types';

export interface OfficialPrintSwiftManagerProps {
  scope: 'hub_manager' | 'super_admin';
  scopedHub?: ServiceHubRecord | null;
  hubs?: ServiceHubRecord[];
  onSaved?: () => void;
  onNotice?: (type: 'success' | 'error' | 'info', text: string) => void;
}

interface OfficialHubDraft {
  listingId: string | null;
  hubId: string;
  title: string;
  locality: string;
  localityId: string | null;
  address: string;
  phone: string;
  whatsapp: string;
  openingHours: string;
  lat: number;
  lng: number;
  coverImage: string;
  logoUrl: string;
  isAcceptingOrders: boolean;
  expressEtaMins: number;
  supportsPickNDrop: boolean;
  turnaroundBadge: PrintTurnaroundBadge;
  pickupInstructions: string;
  capabilities: PrintCapabilities;
  pricingMatrix: Required<
    Pick<
      PrintRateCard,
      | 'bw_a4_single_inr'
      | 'bw_a4_duplex_inr'
      | 'color_a4_single_inr'
      | 'color_a4_duplex_inr'
      | 'a3_bw_inr'
      | 'a3_bw_duplex_inr'
      | 'a3_color_inr'
      | 'a3_color_duplex_inr'
      | 'legal_bw_single_inr'
      | 'legal_bw_duplex_inr'
      | 'legal_color_single_inr'
      | 'legal_color_duplex_inr'
      | 'spiral_binding_inr'
      | 'hard_binding_inr'
      | 'lamination_per_sheet_inr'
      | 'staple_inr'
      | 'sealed_envelope_inr'
      | 'min_order_inr'
      | 'urgent_express_surcharge_value'
    >
  > & {
    urgent_express_surcharge_type: 'flat' | 'percent';
  };
  pricingVersion: number;
}

const DEFAULT_PRICING_MATRIX: OfficialHubDraft['pricingMatrix'] = {
  bw_a4_single_inr: 3,
  bw_a4_duplex_inr: 5,
  color_a4_single_inr: 12,
  color_a4_duplex_inr: 20,
  a3_bw_inr: 15,
  a3_bw_duplex_inr: 25,
  a3_color_inr: 40,
  a3_color_duplex_inr: 65,
  legal_bw_single_inr: 4,
  legal_bw_duplex_inr: 7,
  legal_color_single_inr: 15,
  legal_color_duplex_inr: 26,
  spiral_binding_inr: 40,
  hard_binding_inr: 120,
  lamination_per_sheet_inr: 25,
  staple_inr: 5,
  sealed_envelope_inr: 10,
  min_order_inr: 15,
  urgent_express_surcharge_type: 'flat',
  urgent_express_surcharge_value: 25,
};

const DEFAULT_CAPS: PrintCapabilities = {
  bw_a4: true,
  color_a4: true,
  duplex: true,
  a3_large: true,
  spiral_binding: true,
  lamination: true,
  custom_digital_jobs: true,
  sealed_envelope: true,
};

const TURNAROUND_OPTIONS: CustomSelectOption[] = [
  { value: 'express_30m', label: 'Express (~30 min)' },
  { value: 'same_day', label: 'Same-Day' },
  { value: 'next_day', label: 'Next-Day' },
];

const SURCHARGE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'flat', label: 'Flat Fee (₹)' },
  { value: 'percent', label: 'Percentage (%)' },
];

const CAPABILITY_ITEMS: Array<{ key: keyof PrintCapabilities; label: string }> =
  [
    { key: 'bw_a4', label: 'B&W A4' },
    { key: 'color_a4', label: 'Color A4' },
    { key: 'duplex', label: 'Double-Sided (Duplex)' },
    { key: 'a3_large', label: 'A3 Large Format' },
    { key: 'spiral_binding', label: 'Spiral & Hard Binding' },
    { key: 'lamination', label: 'Lamination' },
    { key: 'custom_digital_jobs', label: 'Custom Digital & Design' },
    { key: 'sealed_envelope', label: 'Sealed Privacy Envelope' },
  ];

function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function readNum(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function buildEmptyDraft(hub: ServiceHubRecord | null | undefined): OfficialHubDraft {
  const hubName = hub?.name?.trim() || 'Local Hub';
  const contact = (hub?.office_contact || {}) as Record<string, unknown>;
  return {
    listingId: null,
    hubId: hub?.id || '',
    title: `DD oodle Express Print Hub — ${
      hub?.slug === 'ccpur' ? 'Lamka' : hubName
    }`,
    locality: hub?.slug === 'ccpur' ? 'Lamka Bazar' : hubName,
    localityId: null,
    address:
      typeof contact.address === 'string' && contact.address.trim()
        ? contact.address.trim()
        : `${hubName} Main Counter`,
    phone:
      typeof contact.phone === 'string' && contact.phone.trim()
        ? contact.phone.trim()
        : '+91 98620 11001',
    whatsapp:
      typeof contact.whatsapp === 'string' && contact.whatsapp.trim()
        ? contact.whatsapp.trim()
        : typeof contact.phone === 'string' && contact.phone.trim()
          ? contact.phone.trim()
          : '+91 98620 11001',
    openingHours:
      typeof contact.operating_hours === 'string' &&
      contact.operating_hours.trim()
        ? contact.operating_hours.trim()
        : 'Mon–Sat: 08:30 AM – 07:30 PM',
    lat: Number(hub?.center_lat ?? 24.3338),
    lng: Number(hub?.center_lng ?? 93.6836),
    coverImage: `https://picsum.photos/seed/dd-print-official-${hub?.slug || 'hub'}/960/640`,
    logoUrl: '',
    isAcceptingOrders: true,
    expressEtaMins: 30,
    supportsPickNDrop: true,
    turnaroundBadge: 'express_30m',
    pickupInstructions:
      'Show your 4-digit Collection OTP at the Official DD oodle Print counter, or choose Pick N Drop door delivery.',
    capabilities: { ...DEFAULT_CAPS },
    pricingMatrix: { ...DEFAULT_PRICING_MATRIX },
    pricingVersion: 1,
  };
}

function OfficialPinPanController({
  panRequest,
}: {
  panRequest: { center: LatLngPoint; zoom: number; seq: number } | null;
}) {
  const map = useMap('official-printswift-coord-map');
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!map || !panRequest || panRequest.seq === lastSeqRef.current) return;
    lastSeqRef.current = panRequest.seq;
    map.panTo(panRequest.center);
    map.setZoom(panRequest.zoom);
  }, [map, panRequest]);

  return null;
}

export function OfficialPrintSwiftManager({
  scope,
  scopedHub = null,
  hubs = [],
  onSaved,
  onNotice,
}: OfficialPrintSwiftManagerProps) {
  const { user } = useAuth();
  const { setStatus } = useAppStatus();
  const { apiKeyAvailable } = useMapsAvailability();
  const {
    mapStyle,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    useVectorStylePreview,
  } = useAppStore();

  const availableHubs = useMemo(() => {
    if (scope === 'hub_manager' && scopedHub) return [scopedHub];
    return hubs.length > 0 ? hubs : scopedHub ? [scopedHub] : [];
  }, [hubs, scope, scopedHub]);

  const [selectedHubId, setSelectedHubId] = useState<string>(
    scopedHub?.id || hubs[0]?.id || ''
  );

  const effectiveHubId =
    scope === 'hub_manager'
      ? scopedHub?.id || selectedHubId
      : selectedHubId || availableHubs[0]?.id || '';

  const activeHubObj = useMemo(
    () =>
      availableHubs.find((h) => h.id === effectiveHubId) ||
      scopedHub ||
      availableHubs[0] ||
      null,
    [availableHubs, effectiveHubId, scopedHub]
  );

  const hubSelectOptions = useMemo<CustomSelectOption[]>(
    () =>
      availableHubs.map((h) => ({
        value: h.id,
        label: `${h.name} (${h.state})`,
      })),
    [availableHubs]
  );

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OfficialHubDraft>(() =>
    buildEmptyDraft(activeHubObj)
  );
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [panRequest, setPanRequest] = useState<{
    center: LatLngPoint;
    zoom: number;
    seq: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [confirmProvisionOpen, setConfirmProvisionOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const resolvedCloudConfig = useMemo(
    () =>
      resolveCloudMapConfiguration({
        mapStyle,
        mapAppearance,
        configuredMapId,
        configuredLightMapId,
        configuredDarkMapId,
      }),
    [
      mapStyle,
      mapAppearance,
      configuredMapId,
      configuredLightMapId,
      configuredDarkMapId,
    ]
  );

  const loadOfficialHub = useCallback(async () => {
    if (!effectiveHubId || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const [profilesRes, titleFallbackRes] = await Promise.all([
        supabase
          .from('listing_print_profiles')
          .select('*')
          .eq('hub_id', effectiveHubId)
          .order('updated_at', { ascending: false })
          .limit(30),
        supabase
          .from('listings')
          .select('*')
          .eq('hub_id', effectiveHubId)
          .ilike('title', '%PrintSwift Express Hub%')
          .limit(5),
      ]);

      const rawProfiles = Array.isArray(profilesRes.data)
        ? (profilesRes.data as Array<Record<string, unknown>>)
        : [];
      const officialRawProfile =
        rawProfiles.find(
          (row) =>
            row.is_official_printswift === true ||
            row.is_first_party_printswift === true
        ) || null;

      let listingRow: Record<string, unknown> | null = null;
      if (officialRawProfile?.listing_id) {
        const { data: lData } = await supabase
          .from('listings')
          .select('*')
          .eq('id', String(officialRawProfile.listing_id))
          .maybeSingle();
        if (lData) listingRow = lData as Record<string, unknown>;
      } else if (
        Array.isArray(titleFallbackRes.data) &&
        titleFallbackRes.data.length > 0
      ) {
        listingRow = titleFallbackRes.data[0] as Record<string, unknown>;
      }

      if (!listingRow && !officialRawProfile) {
        const empty = buildEmptyDraft(activeHubObj);
        setDraft(empty);
        setSavedSnapshot(JSON.stringify(empty));
        setPanRequest((prev) => ({
          center: { lat: empty.lat, lng: empty.lng },
          zoom: 14,
          seq: (prev?.seq || 0) + 1,
        }));
        return;
      }

      const normProf = officialRawProfile
        ? normalizeClientPrintProfile(officialRawProfile)
        : null;
      const base = buildEmptyDraft(activeHubObj);
      const l = listingRow || {};
      const coords = asRecord(l.coordinates);
      const meta = asRecord(l.metadata);
      const svc = asRecord(l.service_details);
      const vs = asRecord(l.vertical_summary);
      const rateCard = normProf?.pricing_matrix || normProf?.rate_card || {};

      const nextLat =
        l.lat !== null && l.lat !== undefined && Number.isFinite(Number(l.lat))
          ? Number(l.lat)
          : Number.isFinite(Number(coords.lat))
            ? Number(coords.lat)
            : base.lat;
      const nextLng =
        l.lng !== null && l.lng !== undefined && Number.isFinite(Number(l.lng))
          ? Number(l.lng)
          : Number.isFinite(Number(coords.lng))
            ? Number(coords.lng)
            : base.lng;

      const resolvedPhone = String(
        l.phone || l.contact_phone || base.phone
      ).trim();
      const resolvedWhatsapp = String(
        l.whatsapp || meta.whatsapp || resolvedPhone || base.whatsapp
      ).trim();
      const resolvedHours = String(
        l.opening_hours || svc.working_hours || meta.opening_hours || base.openingHours
      ).trim();
      const resolvedLogo = String(
        l.logo_url || vs.logo_url || meta.logo_url || ''
      ).trim();

      const nextDraft: OfficialHubDraft = {
        listingId: l.id
          ? String(l.id)
          : normProf?.listing_id
            ? normProf.listing_id
            : null,
        hubId: effectiveHubId,
        title:
          String(l.title || base.title)
            .replace(/^\[SAMPLE\]\s*/i, '')
            .trim() || base.title,
        locality: String(l.locality || base.locality).trim(),
        localityId: l.locality_id ? String(l.locality_id) : null,
        address: String(l.address || base.address).trim(),
        phone: resolvedPhone,
        whatsapp: resolvedWhatsapp,
        openingHours: resolvedHours,
        lat: Number(nextLat.toFixed(6)),
        lng: Number(nextLng.toFixed(6)),
        coverImage: String(l.cover_image || base.coverImage).trim(),
        logoUrl: resolvedLogo,
        isAcceptingOrders: normProf ? normProf.is_accepting_orders : true,
        expressEtaMins: normProf?.express_eta_mins ?? 30,
        supportsPickNDrop: normProf?.supports_pick_n_drop !== false,
        turnaroundBadge: normProf?.turnaround_badge ?? 'express_30m',
        pickupInstructions: String(
          normProf?.pickup_instructions || base.pickupInstructions
        ),
        capabilities: normProf?.capabilities || { ...DEFAULT_CAPS },
        pricingMatrix: {
          bw_a4_single_inr: readNum(
            rateCard.bw_a4_single_inr,
            DEFAULT_PRICING_MATRIX.bw_a4_single_inr
          ),
          bw_a4_duplex_inr: readNum(
            rateCard.bw_a4_duplex_inr,
            DEFAULT_PRICING_MATRIX.bw_a4_duplex_inr
          ),
          color_a4_single_inr: readNum(
            rateCard.color_a4_single_inr,
            DEFAULT_PRICING_MATRIX.color_a4_single_inr
          ),
          color_a4_duplex_inr: readNum(
            rateCard.color_a4_duplex_inr,
            DEFAULT_PRICING_MATRIX.color_a4_duplex_inr
          ),
          a3_bw_inr: readNum(
            rateCard.a3_bw_inr,
            DEFAULT_PRICING_MATRIX.a3_bw_inr
          ),
          a3_bw_duplex_inr: readNum(
            rateCard.a3_bw_duplex_inr,
            DEFAULT_PRICING_MATRIX.a3_bw_duplex_inr
          ),
          a3_color_inr: readNum(
            rateCard.a3_color_inr,
            DEFAULT_PRICING_MATRIX.a3_color_inr
          ),
          a3_color_duplex_inr: readNum(
            rateCard.a3_color_duplex_inr,
            DEFAULT_PRICING_MATRIX.a3_color_duplex_inr
          ),
          legal_bw_single_inr: readNum(
            rateCard.legal_bw_single_inr,
            DEFAULT_PRICING_MATRIX.legal_bw_single_inr
          ),
          legal_bw_duplex_inr: readNum(
            rateCard.legal_bw_duplex_inr,
            DEFAULT_PRICING_MATRIX.legal_bw_duplex_inr
          ),
          legal_color_single_inr: readNum(
            rateCard.legal_color_single_inr,
            DEFAULT_PRICING_MATRIX.legal_color_single_inr
          ),
          legal_color_duplex_inr: readNum(
            rateCard.legal_color_duplex_inr,
            DEFAULT_PRICING_MATRIX.legal_color_duplex_inr
          ),
          spiral_binding_inr: readNum(
            rateCard.spiral_binding_inr,
            DEFAULT_PRICING_MATRIX.spiral_binding_inr
          ),
          hard_binding_inr: readNum(
            rateCard.hard_binding_inr,
            DEFAULT_PRICING_MATRIX.hard_binding_inr
          ),
          lamination_per_sheet_inr: readNum(
            rateCard.lamination_per_sheet_inr,
            DEFAULT_PRICING_MATRIX.lamination_per_sheet_inr
          ),
          staple_inr: readNum(
            rateCard.staple_inr,
            DEFAULT_PRICING_MATRIX.staple_inr
          ),
          sealed_envelope_inr: readNum(
            rateCard.sealed_envelope_inr,
            DEFAULT_PRICING_MATRIX.sealed_envelope_inr
          ),
          min_order_inr: readNum(
            rateCard.min_order_inr,
            DEFAULT_PRICING_MATRIX.min_order_inr
          ),
          urgent_express_surcharge_type:
            rateCard.urgent_express_surcharge_type === 'percent'
              ? 'percent'
              : 'flat',
          urgent_express_surcharge_value: readNum(
            rateCard.urgent_express_surcharge_value,
            DEFAULT_PRICING_MATRIX.urgent_express_surcharge_value
          ),
        },
        pricingVersion: normProf?.pricing_version ?? 1,
      };

      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(nextDraft));
      setPanRequest((prev) => ({
        center: { lat: nextDraft.lat, lng: nextDraft.lng },
        zoom: 15,
        seq: (prev?.seq || 0) + 1,
      }));
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Failed to load Official DD oodle Print hub settings.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeHubObj, effectiveHubId]);

  useEffect(() => {
    void loadOfficialHub();
  }, [loadOfficialHub]);

  const isDirty = useMemo(() => {
    if (!draft.listingId || !savedSnapshot) return false;
    return JSON.stringify(draft) !== savedSnapshot;
  }, [draft, savedSnapshot]);

  const updateMatrixField = <
    K extends keyof OfficialHubDraft['pricingMatrix'],
  >(
    key: K,
    value: OfficialHubDraft['pricingMatrix'][K]
  ) => {
    setDraft((prev) => ({
      ...prev,
      pricingMatrix: {
        ...prev.pricingMatrix,
        [key]: value,
      },
    }));
  };

  const handleCaptureGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error', 'Browser GPS geolocation is unavailable.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setDraft((prev) => ({ ...prev, lat, lng }));
        setPanRequest((prev) => ({
          center: { lat, lng },
          zoom: 16,
          seq: (prev?.seq || 0) + 1,
        }));
        setIsLocating(false);
        setStatus('success', 'Captured GPS coordinates into draft.');
      },
      () => {
        setIsLocating(false);
        setStatus('error', 'Unable to read GPS location.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSnapToHubCenter = () => {
    if (!activeHubObj) return;
    const lat = Number(Number(activeHubObj.center_lat).toFixed(6));
    const lng = Number(Number(activeHubObj.center_lng).toFixed(6));
    setDraft((prev) => ({ ...prev, lat, lng }));
    setPanRequest((prev) => ({
      center: { lat, lng },
      zoom: 15,
      seq: (prev?.seq || 0) + 1,
    }));
  };

  const handleLocalitySelect = (loc: LocalitySelection) => {
    setDraft((prev) => ({
      ...prev,
      locality: loc.display_name,
      localityId: loc.id ?? null,
      lat:
        typeof loc.lat === 'number' && Number.isFinite(loc.lat)
          ? Number(loc.lat.toFixed(6))
          : prev.lat,
      lng:
        typeof loc.lng === 'number' && Number.isFinite(loc.lng)
          ? Number(loc.lng.toFixed(6))
          : prev.lng,
    }));
    if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      setPanRequest((prev) => ({
        center: { lat: Number(loc.lat), lng: Number(loc.lng) },
        zoom: 15,
        seq: (prev?.seq || 0) + 1,
      }));
    }
  };

  const handleConfirmProvisionOrSave = async (isProvision = false) => {
    if (!effectiveHubId || !isSupabaseConfigured()) return;
    if (!draft.title.trim()) {
      setStatus('error', 'Official DD oodle Print Hub name is required.');
      return;
    }

    setIsSaving(true);
    setStatus(
      'saving',
      isProvision
        ? 'Provisioning Official DD oodle Print Hub...'
        : 'Saving Official DD oodle Print Hub settings...'
    );

    try {
      const nowIso = new Date().toISOString();
      const matrixPayload: PrintRateCard = {
        ...draft.pricingMatrix,
        platform_fee_inr: 0,
        bulk_discounts: [],
      };
      const verifiedCaps = { ...draft.capabilities };
      const summaryMerge = {
        is_official_printswift: true,
        is_first_party_printswift: true,
        is_accepting_orders: draft.isAcceptingOrders,
        express_eta_mins: Math.max(5, Math.round(draft.expressEtaMins || 30)),
        supports_pick_n_drop: draft.supportsPickNDrop,
        turnaround_badge: draft.turnaroundBadge,
        verified_capabilities: verifiedCaps,
        has_active_entitlement: true,
        ...(draft.logoUrl ? { logo_url: draft.logoUrl } : {}),
      };
      const metaPayload = {
        whatsapp: draft.whatsapp.trim() || draft.phone.trim(),
        opening_hours: draft.openingHours.trim(),
        logo_url: draft.logoUrl.trim() || null,
      };
      const serviceDetailsPayload = {
        service_type: 'Document & Digital Printing',
        working_hours: draft.openingHours.trim(),
        availability_status: draft.isAcceptingOrders
          ? `Express ~${draft.expressEtaMins} min`
          : 'Pre-Launch / Paused',
      };

      let targetListingId = draft.listingId;

      const baseListingPayload = {
        title: draft.title.trim(),
        category: 'service',
        subcategory: 'Document & Xerox Print',
        status: 'published',
        lifecycle_status: 'active',
        verification_status: 'verified',
        is_featured_demo: false,
        locality: draft.locality.trim() || activeHubObj?.name || 'Central Hub',
        locality_id: draft.localityId,
        address: draft.address.trim(),
        phone: draft.phone.trim(),
        contact_phone: draft.phone.trim(),
        cover_image: draft.coverImage.trim(),
        coordinates: { lat: draft.lat, lng: draft.lng },
        lat: draft.lat,
        lng: draft.lng,
        hub_id: effectiveHubId,
        listing_vertical: 'print_digital',
        is_civic_record: false,
        vertical_summary: summaryMerge,
        service_details: serviceDetailsPayload,
        metadata: metaPayload,
        updated_at: nowIso,
      };

      const extendedListingPayload = {
        ...baseListingPayload,
        whatsapp: draft.whatsapp.trim() || draft.phone.trim(),
        opening_hours: draft.openingHours.trim(),
        logo_url: draft.logoUrl.trim() || null,
        is_verified: true,
      };

      if (!targetListingId) {
        const insertPayload = {
          ...extendedListingPayload,
          owner_id: user?.id || null,
          owner_name: 'DD oodle Print Official',
          short_description:
            'Official DD oodle Print counter for express PDF printing, binding, lamination & Pick N Drop dispatch.',
          description:
            'First-party DD oodle digital print hub managed by Hub Governance.',
          price: draft.pricingMatrix.bw_a4_single_inr,
          gallery_images: [],
          rating: 4.9,
          review_count: 1,
        };

        let insRes = await supabase
          .from('listings')
          .insert(insertPayload)
          .select('id')
          .single();

        if (
          insRes.error &&
          /column|schema cache|42703|PGRST204/i.test(insRes.error.message)
        ) {
          const fallbackInsert = {
            ...baseListingPayload,
            owner_id: user?.id || null,
            owner_name: 'DD oodle Print Official',
            short_description:
              'Official DD oodle Print counter for express PDF printing, binding, lamination & Pick N Drop dispatch.',
            description:
              'First-party DD oodle digital print hub managed by Hub Governance.',
            price: draft.pricingMatrix.bw_a4_single_inr,
            gallery_images: [],
            rating: 4.9,
            review_count: 1,
          };
          insRes = await supabase
            .from('listings')
            .insert(fallbackInsert)
            .select('id')
            .single();
        }

        if (insRes.error || !insRes.data?.id) {
          throw new Error(
            insRes.error?.message ||
              'Failed to create Official DD oodle Print listing.'
          );
        }
        targetListingId = String(insRes.data.id);
      } else {
        let updRes = await supabase
          .from('listings')
          .update(extendedListingPayload)
          .eq('id', targetListingId);

        if (
          updRes.error &&
          /column|schema cache|42703|PGRST204/i.test(updRes.error.message)
        ) {
          updRes = await supabase
            .from('listings')
            .update(baseListingPayload)
            .eq('id', targetListingId);
        }

        if (updRes.error) {
          throw new Error(updRes.error.message);
        }
      }

      const extendedProfilePayload = {
        listing_id: targetListingId,
        hub_id: effectiveHubId,
        is_official_printswift: true,
        is_first_party_printswift: true,
        is_accepting_orders: draft.isAcceptingOrders,
        express_eta_mins: Math.max(5, Math.round(draft.expressEtaMins || 30)),
        supports_pick_n_drop: draft.supportsPickNDrop,
        turnaround_badge: draft.turnaroundBadge,
        capabilities: draft.capabilities,
        verified_capabilities: verifiedCaps,
        pricing_matrix: matrixPayload,
        rate_card: matrixPayload,
        payment_policy: {
          allow_direct_pay: false,
          direct_pay_max_inr: 0,
          allow_escrow: true,
          shop_upi_id: null,
          shop_upi_name: 'DD oodle Print Official',
          shop_upi_verified: false,
        },
        pickup_instructions: draft.pickupInstructions.trim() || null,
        updated_at: nowIso,
      };

      let profRes = await supabase
        .from('listing_print_profiles')
        .upsert(extendedProfilePayload, { onConflict: 'listing_id' });

      if (
        profRes.error &&
        /column|schema cache|42703|PGRST204/i.test(profRes.error.message)
      ) {
        const legacyProfilePayload = {
          listing_id: targetListingId,
          hub_id: effectiveHubId,
          is_first_party_printswift: true,
          is_accepting_orders: draft.isAcceptingOrders,
          turnaround_badge: draft.turnaroundBadge,
          capabilities: draft.capabilities,
          verified_capabilities: verifiedCaps,
          rate_card: matrixPayload,
          payment_policy: {
            allow_direct_pay: false,
            direct_pay_max_inr: 0,
            allow_escrow: true,
            shop_upi_id: null,
            shop_upi_name: 'DD oodle Print Official',
            shop_upi_verified: false,
          },
          pickup_instructions: draft.pickupInstructions.trim() || null,
          updated_at: nowIso,
        };
        profRes = await supabase
          .from('listing_print_profiles')
          .upsert(legacyProfilePayload, { onConflict: 'listing_id' });
      }

      if (profRes.error) {
        throw new Error(profRes.error.message);
      }

      const msg = isProvision
        ? `Provisioned Official DD oodle Print Hub for ${activeHubObj?.name || 'hub'}.`
        : `Saved Official DD oodle Print settings for ${activeHubObj?.name || 'hub'}.`;

      setConfirmSaveOpen(false);
      setConfirmProvisionOpen(false);
      setStatus('success', msg);
      onNotice?.('success', msg);
      await loadOfficialHub();
      onSaved?.();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to save Official DD oodle Print Hub settings.';
      setStatus('error', msg);
      onNotice?.('error', msg);
    } finally {
      setIsSaving(false);
    }
  };

  const numberField = (
    label: string,
    key: Exclude<
      keyof OfficialHubDraft['pricingMatrix'],
      'urgent_express_surcharge_type'
    >,
    suffix = '₹'
  ) => (
    <label className="block space-y-1 min-w-0">
      <span className="block text-[11px] font-semibold text-[var(--ps-text-muted)] truncate">
        {label}
      </span>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-2.5 text-[11px] font-bold text-[var(--ps-text-muted)]">
          {suffix}
        </span>
        <input
          type="number"
          min={0}
          step="0.5"
          value={draft.pricingMatrix[key]}
          onChange={(e) => {
            const val = Number.parseFloat(e.target.value);
            updateMatrixField(key, Number.isFinite(val) && val >= 0 ? val : 0);
          }}
          className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-6 pr-2.5 text-xs font-bold text-[var(--ps-text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-theme-primary"
        />
      </div>
    </label>
  );

  return (
    <section
      data-testid="official-printswift-manager"
      className="min-w-0 max-w-full rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 sm:p-5 shadow-xs space-y-4"
    >
      {/* Top Governance Header + Hub Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-3.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
            <Printer className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-bold text-[var(--ps-text)] break-words">
                Official DD oodle Print Hub Manager
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <Sparkles className="h-2.5 w-2.5" />
                <span>
                  {scope === 'super_admin'
                    ? 'Global Governance'
                    : `${activeHubObj?.name || 'Hub'} Scoped`}
                </span>
              </span>
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5 line-clamp-2 sm:line-clamp-none">
              Exclusively governed by Hub Managers &amp; Super-Admins. Controls
              pin coordinates, live pricing matrix, turnaround SLA, and online
              acceptance.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {scope === 'super_admin' && hubSelectOptions.length > 0 ? (
            <div className="w-full sm:w-52 min-w-0">
              <CustomSelectModal
                value={effectiveHubId}
                onChange={setSelectedHubId}
                options={hubSelectOptions}
                label="Select Hub"
                placeholder="Select Service Hub"
                testId="official-printswift-hub-select"
              />
            </div>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-bold text-[var(--ps-text)]">
              <Building2 className="h-3.5 w-3.5 text-theme-primary" />
              <span>{activeHubObj?.name || 'Scoped Hub'}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadOfficialHub()}
            disabled={isLoading || isSaving}
            aria-label="Reload Official DD oodle Print Hub"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Reload</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs font-medium text-rose-700 dark:text-rose-300">
          {loadError}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-theme-primary" />
          <span>
            Loading Official DD oodle Print configuration for{' '}
            {activeHubObj?.name || 'hub'}…
          </span>
        </div>
      ) : !draft.listingId ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center space-y-3">
          <Printer className="mx-auto h-7 w-7 text-[var(--ps-text-muted)]" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              No Official DD oodle Print Hub Linked to {activeHubObj?.name || 'This Hub'}
            </h3>
            <p className="text-xs text-[var(--ps-text-muted)] max-w-lg mx-auto">
              Provision a dedicated real-UUID Official DD oodle Print hub listing
              and complete pricing matrix directly for{' '}
              <strong>{activeHubObj?.name || 'this hub'}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmProvisionOpen(true)}
            disabled={isSaving}
            data-testid="provision-official-printswift-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 text-xs font-bold text-[var(--btn-primary-fg)] shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>
              Provision Official DD oodle Print Hub ({activeHubObj?.name || 'Hub'})
            </span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Quick Status & Live Link Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  draft.isAcceptingOrders
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}
              >
                <CheckCircle2 className="h-3 w-3" />
                <span>
                  {draft.isAcceptingOrders ? 'Accepting Online Orders' : 'Paused'}
                </span>
              </span>
              <span className="font-mono text-[10px] text-[var(--ps-text-muted)] truncate">
                UUID: {draft.listingId} · Rate v{draft.pricingVersion}
              </span>
            </div>

            <Link
              href={`/listing/${encodeURIComponent(draft.listingId)}/print`}
              target="_blank"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-bold text-theme-primary hover:bg-[var(--ps-surface-alt)] shrink-0"
            >
              <span>Open Live Print Page</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {/* Section 1: Hub Identity, Address & Contact */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3 min-w-0">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)] flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-theme-primary" />
                <span>Hub Identity &amp; Contact</span>
              </h3>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Print Center Name
                </span>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="DD oodle Express Print Hub — Lamka"
                  className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                />
              </label>

              <div>
                <LocalityCombobox
                  hubId={effectiveHubId}
                  value={{
                    id: draft.localityId,
                    display_name: draft.locality,
                  }}
                  onSelect={handleLocalitySelect}
                  allowCreate={false}
                  label="Locality / Veng"
                  placeholder="Select verified hub locality..."
                />
              </div>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Counter Street Address
                </span>
                <input
                  type="text"
                  value={draft.address}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, address: e.target.value }))
                  }
                  className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)] flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    <span>Phone</span>
                  </span>
                  <input
                    type="tel"
                    value={draft.phone}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    WhatsApp Number
                  </span>
                  <input
                    type="tel"
                    value={draft.whatsapp}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, whatsapp: e.target.value }))
                    }
                    className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-[var(--ps-text-muted)] flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>Operating Hours</span>
                </span>
                <input
                  type="text"
                  value={draft.openingHours}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      openingHours: e.target.value,
                    }))
                  }
                  placeholder="Mon–Sat: 08:30 AM – 07:30 PM"
                  className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-theme-primary"
                />
              </label>
            </div>

            {/* Section 2: Interactive Coordinates + Brand Media */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)] flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-theme-primary" />
                  <span>Pin Coordinates &amp; Media</span>
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSnapToHubCenter}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-[10px] font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                  >
                    <Crosshair className="h-3 w-3" />
                    <span>Hub Center</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCaptureGps}
                    disabled={isLocating}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-[10px] font-bold text-theme-primary hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                  >
                    <Navigation className="h-3 w-3" />
                    <span>{isLocating ? 'Locating…' : 'Use GPS'}</span>
                  </button>
                </div>
              </div>

              {/* Mini-Map Coordinate Picker (pan crosshair over exact counter location) */}
              <div
                className="relative h-48 w-full overflow-hidden rounded-xl border border-[var(--ps-border)]"
                style={{ backgroundColor: resolvedCloudConfig.backgroundColor }}
              >
                {apiKeyAvailable && !useVectorStylePreview ? (
                  <GoogleMap
                    key={`official-print-map-${effectiveHubId}-${resolvedCloudConfig.mapId}`}
                    id="official-printswift-coord-map"
                    mapId={resolvedCloudConfig.mapId}
                    defaultCenter={{ lat: draft.lat, lng: draft.lng }}
                    defaultZoom={15}
                    mapTypeId={resolvedCloudConfig.mapTypeId}
                    colorScheme={resolvedCloudConfig.colorScheme}
                    backgroundColor={resolvedCloudConfig.backgroundColor}
                    gestureHandling="greedy"
                    disableDefaultUI={true}
                    zoomControl={true}
                    clickableIcons={false}
                    controlSize={26}
                    internalUsageAttributionIds={[
                      'gmp_mcp_codeassist_v1_aistudio',
                      'gmp_git_agentskills_v1',
                    ]}
                    onCameraChanged={(ev) => {
                      if (ev.detail.center) {
                        setDraft((prev) => ({
                          ...prev,
                          lat: Number(ev.detail.center.lat.toFixed(6)),
                          lng: Number(ev.detail.center.lng.toFixed(6)),
                        }));
                      }
                    }}
                    className="w-full h-full"
                  >
                    <OfficialPinPanController panRequest={panRequest} />
                  </GoogleMap>
                ) : (
                  <InteractiveVectorMap
                    listings={[]}
                    selectedListing={null}
                    onSelectListing={() => {}}
                    mapStyle={mapStyle}
                    mapAppearance={resolvedCloudConfig.variant}
                    center={{ lat: draft.lat, lng: draft.lng }}
                    zoom={15}
                    defaultCenter={{ lat: draft.lat, lng: draft.lng }}
                    onCameraChange={(nextCenter) => {
                      setDraft((prev) => ({
                        ...prev,
                        lat: Number(nextCenter.lat.toFixed(6)),
                        lng: Number(nextCenter.lng.toFixed(6)),
                      }));
                    }}
                  />
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/15 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Latitude
                  </span>
                  <input
                    type="number"
                    step="0.000001"
                    value={draft.lat}
                    onChange={(e) => {
                      const val = Number.parseFloat(e.target.value);
                      if (Number.isFinite(val)) {
                        setDraft((prev) => ({ ...prev, lat: val }));
                      }
                    }}
                    className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-mono text-xs text-[var(--ps-text)] tabular-nums"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Longitude
                  </span>
                  <input
                    type="number"
                    step="0.000001"
                    value={draft.lng}
                    onChange={(e) => {
                      const val = Number.parseFloat(e.target.value);
                      if (Number.isFinite(val)) {
                        setDraft((prev) => ({ ...prev, lng: val }));
                      }
                    }}
                    className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-mono text-xs text-[var(--ps-text)] tabular-nums"
                  />
                </label>
              </div>

              {/* Cover Photo & Logo Upload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)] flex items-center gap-1">
                    <ImagePlus className="h-3 w-3" />
                    <span>Cover Photo</span>
                  </span>
                  <MediaUploader
                    mode="image"
                    listingId={draft.listingId || 'official-print'}
                    label="Upload Cover"
                    helperText="Wide banner photo"
                    onUploadSuccess={(url) =>
                      setDraft((prev) => ({ ...prev, coverImage: url }))
                    }
                  />
                  <input
                    type="url"
                    value={draft.coverImage}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        coverImage: e.target.value,
                      }))
                    }
                    placeholder="https://..."
                    className="h-8 w-full min-w-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] text-[var(--ps-text)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)] flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    <span>Hub Brand Logo</span>
                  </span>
                  <MediaUploader
                    mode="image"
                    listingId={draft.listingId || 'official-print-logo'}
                    label="Upload Logo"
                    helperText="Square circular pin icon"
                    onUploadSuccess={(url) =>
                      setDraft((prev) => ({ ...prev, logoUrl: url }))
                    }
                  />
                  <input
                    type="url"
                    value={draft.logoUrl}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, logoUrl: e.target.value }))
                    }
                    placeholder="https://..."
                    className="h-8 w-full min-w-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] text-[var(--ps-text)]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Fulfillment Operations & Capabilities */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)] flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-theme-primary" />
              <span>Order Acceptance, SLA &amp; Verified Capabilities</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    isAcceptingOrders: !prev.isAcceptingOrders,
                  }))
                }
                data-testid="official-print-toggle-accepting"
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition cursor-pointer ${
                  draft.isAcceptingOrders
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">Accept Online Orders</div>
                  <div className="text-[10px] opacity-80">
                    {draft.isAcceptingOrders
                      ? 'Live for users on Explore & /print'
                      : 'Pre-launch / Paused'}
                  </div>
                </div>
                <span className="text-[10px] font-extrabold uppercase">
                  {draft.isAcceptingOrders ? 'ON' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    supportsPickNDrop: !prev.supportsPickNDrop,
                  }))
                }
                data-testid="official-print-toggle-pnd"
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition cursor-pointer ${
                  draft.supportsPickNDrop
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Truck className="h-4 w-4 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">Pick N Drop Delivery</div>
                    <div className="text-[10px] opacity-80">
                      {draft.supportsPickNDrop ? 'Enabled' : 'Pickup only'}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold uppercase">
                  {draft.supportsPickNDrop ? 'ON' : 'OFF'}
                </span>
              </button>

              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Express Turnaround (mins)
                </span>
                <input
                  type="number"
                  min={5}
                  max={2880}
                  value={draft.expressEtaMins}
                  onChange={(e) => {
                    const mins = Number.parseInt(e.target.value, 10);
                    setDraft((prev) => ({
                      ...prev,
                      expressEtaMins:
                        Number.isFinite(mins) && mins >= 5 ? mins : 30,
                    }));
                  }}
                  className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-bold text-[var(--ps-text)] tabular-nums"
                />
              </label>

              <div className="space-y-1">
                <span className="block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                  Turnaround Badge
                </span>
                <CustomSelectModal
                  value={draft.turnaroundBadge}
                  onChange={(val) =>
                    setDraft((prev) => ({
                      ...prev,
                      turnaroundBadge: val as PrintTurnaroundBadge,
                    }))
                  }
                  options={TURNAROUND_OPTIONS}
                  label="Turnaround Badge"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {CAPABILITY_ITEMS.map((cap) => {
                const enabled = Boolean(draft.capabilities[cap.key]);
                return (
                  <button
                    key={cap.key}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        capabilities: {
                          ...prev.capabilities,
                          [cap.key]: !prev.capabilities[cap.key],
                        },
                      }))
                    }
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition cursor-pointer ${
                      enabled
                        ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span>{cap.label}</span>
                  </button>
                );
              })}
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Counter Pickup Instructions
              </span>
              <input
                type="text"
                value={draft.pickupInstructions}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    pickupInstructions: e.target.value,
                  }))
                }
                className="h-9 w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)]"
              />
            </label>
          </div>

          {/* Section 4: Full Live Pricing Matrix Editor */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)] flex items-center gap-1.5">
              <IndianRupee className="h-3.5 w-3.5 text-theme-primary" />
              <span>Live Pricing Matrix</span>
            </h3>

            {/* A4 */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                A4 Standard Sheets
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {numberField('B&W Single', 'bw_a4_single_inr')}
                {numberField('B&W Duplex', 'bw_a4_duplex_inr')}
                {numberField('Color Single', 'color_a4_single_inr')}
                {numberField('Color Duplex', 'color_a4_duplex_inr')}
              </div>
            </div>

            {/* A3 */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                A3 Large Format
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {numberField('A3 B&W Single', 'a3_bw_inr')}
                {numberField('A3 B&W Duplex', 'a3_bw_duplex_inr')}
                {numberField('A3 Color Single', 'a3_color_inr')}
                {numberField('A3 Color Duplex', 'a3_color_duplex_inr')}
              </div>
            </div>

            {/* Legal */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Legal Paper
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {numberField('Legal B&W Single', 'legal_bw_single_inr')}
                {numberField('Legal B&W Duplex', 'legal_bw_duplex_inr')}
                {numberField('Legal Color Single', 'legal_color_single_inr')}
                {numberField('Legal Color Duplex', 'legal_color_duplex_inr')}
              </div>
            </div>

            {/* Finishing, Minimum Order & Express Surcharge */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Binding, Lamination, Minimum Order &amp; Express Surcharge
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {numberField('Spiral Binding', 'spiral_binding_inr')}
                {numberField('Thermal / Hard Bind', 'hard_binding_inr')}
                {numberField('Lamination / Sheet', 'lamination_per_sheet_inr')}
                {numberField('Staple Fee', 'staple_inr')}
                {numberField('Sealed Envelope', 'sealed_envelope_inr')}
                {numberField('Minimum Order', 'min_order_inr')}
                <div className="space-y-1 min-w-0">
                  <span className="block text-[11px] font-semibold text-[var(--ps-text-muted)] truncate">
                    Express Surcharge Type
                  </span>
                  <CustomSelectModal
                    value={draft.pricingMatrix.urgent_express_surcharge_type}
                    onChange={(val) =>
                      updateMatrixField(
                        'urgent_express_surcharge_type',
                        val === 'percent' ? 'percent' : 'flat'
                      )
                    }
                    options={SURCHARGE_TYPE_OPTIONS}
                    label="Urgent Express Surcharge Type"
                  />
                </div>
                {numberField(
                  draft.pricingMatrix.urgent_express_surcharge_type ===
                    'percent'
                    ? 'Express Surcharge (%)'
                    : 'Express Surcharge (₹)',
                  'urgent_express_surcharge_value',
                  draft.pricingMatrix.urgent_express_surcharge_type ===
                    'percent'
                    ? '%'
                    : '₹'
                )}
              </div>
            </div>
          </div>

          {/* Sticky / Clean Save Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-3">
            <div className="text-xs text-[var(--ps-text-muted)]">
              {isDirty ? (
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  Unsaved changes ready to publish
                </span>
              ) : (
                <span>
                  Synced live with Supabase for {activeHubObj?.name || 'this hub'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isDirty && (
                <button
                  type="button"
                  onClick={() => void loadOfficialHub()}
                  disabled={isSaving}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmSaveOpen(true)}
                disabled={isSaving}
                data-testid="save-official-printswift-btn"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 text-xs font-bold text-[var(--btn-primary-fg)] shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Official DD oodle Print Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Save Official Hub Changes */}
      <ConfirmActionModal
        isOpen={confirmSaveOpen}
        title="Save Official DD oodle Print Hub Settings?"
        description={`Publish updated counter details, pin coordinates, pricing matrix, and order acceptance settings for "${draft.title}" in ${activeHubObj?.name || 'this hub'}?`}
        confirmLabel="Publish Settings"
        loading={isSaving}
        onConfirm={() => void handleConfirmProvisionOrSave(false)}
        onCancel={() => {
          if (!isSaving) setConfirmSaveOpen(false);
        }}
      />

      {/* Confirmation Modal: Provision Official Hub */}
      <ConfirmActionModal
        isOpen={confirmProvisionOpen}
        title="Provision Official DD oodle Print Hub?"
        description={`Create a dedicated verified Official DD oodle Print hub listing and complete print profile in Supabase for ${activeHubObj?.name || 'this hub'}?`}
        confirmLabel="Provision Hub"
        loading={isSaving}
        onConfirm={() => void handleConfirmProvisionOrSave(true)}
        onCancel={() => {
          if (!isSaving) setConfirmProvisionOpen(false);
        }}
      />
    </section>
  );
}
