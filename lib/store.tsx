'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { CHURACHANDPUR_SAMPLE_CENTER } from './seed-data';
import {
  DEFAULT_AREA_UNIT,
  canAdminPerformAction,
  hasValidMandatoryPanorama,
  sanitizeRealEstateForPropertyType,
} from './rules';
import { sanitizeMapId } from './map-cloud-styles';
import {
  ADMIN_AUTHORIZED_ROLES,
  WORKSPACE_AUTHORIZED_ROLES,
  canRoleAccessAdmin,
  canRoleAccessWorkspace,
  useAuth as useSupabaseAuthStore,
} from './auth';
import { fetchPublishedListings } from './supabase/listings';
import { fetchAppSettings } from './supabase/admin';
import { isSupabaseConfigured, supabase } from './supabase/client';
import { emitBookmarkChange } from './events';
import {
  fetchMyNotifications,
  markNotificationAsRead,
  subscribeToMyNotifications,
  type LiveNotificationRecord,
} from './supabase/notifications';
import {
  AdminRole,
  AppearanceMode,
  AreaUnit,
  AuditLogEntry,
  CatalogueProduct,
  DrawnShape,
  DynamicFieldDefinition,
  EnquiryRecord,
  LatLngPoint,
  Listing,
  ListingStatus,
  MapAppearanceVariant,
  MapStyleOption,
  ModerationCase,
  NotificationItem,
  ReviewRecord,
  StaffDelegation,
  StaffPermission,
  ThemePreset,
  UserAccount,
  VerificationRequest,
} from './types';

const STORAGE_KEY_STATE = 'printswift_local_demo_state_v1';
const STORAGE_KEY_DRAWN_SHAPES = 'printswift_local_drawn_shapes_v1';
const STORAGE_KEY_THEME = 'printswift_local_theme_v1';
const STORAGE_KEY_MAP_STYLE = 'printswift_local_map_style_v1';
const STORAGE_KEY_MAP_CLOUD_CONFIG = 'printswift_local_map_cloud_config_v1';
const STORAGE_KEY_SPLIT_PCT = 'printswift_local_split_pct_v1';
export const STORAGE_KEY_CUSTOM_DEFAULT_CENTER =
  'printswift_local_custom_default_center_v1';
export const STORAGE_KEY_SIMPLE_MODE = 'printswift_local_simple_mode_v1';
export const STORAGE_KEY_REAL_ESTATE_MODE =
  'printswift_local_real_estate_mode_v1';
export const STORAGE_KEY_EXPLORE_MAP_PRESET = 'dd_explore_map_preset_v1';

export type ExploreMapPresetId =
  | 'everyday'
  | 'clean_focus'
  | 'property_hunter'
  | 'pro_survey';

export interface ExploreMapPresetMeta {
  id: ExploreMapPresetId;
  label: string;
  shortLabel: string;
  description: string;
  badge: string;
  simpleMode: boolean;
  realEstateMode: boolean;
  autoOpenDrawTools: boolean;
}

export const EXPLORE_MAP_PRESETS: readonly ExploreMapPresetMeta[] = [
  {
    id: 'everyday',
    label: 'Everyday Discovery',
    shortLabel: 'Everyday',
    description:
      'Balanced local map with all categories, pins, and collapsible map tools.',
    badge: 'Default',
    simpleMode: false,
    realEstateMode: false,
    autoOpenDrawTools: false,
  },
  {
    id: 'clean_focus',
    label: 'Clean & Simple',
    shortLabel: 'Simple',
    description:
      'Minimal, distraction-free map hiding advanced GIS drawing and measuring tools.',
    badge: 'Minimal',
    simpleMode: true,
    realEstateMode: false,
    autoOpenDrawTools: false,
  },
  {
    id: 'property_hunter',
    label: 'Property & Plots',
    shortLabel: 'Property',
    description:
      'Property-focused view with price bubbles, rentals, and plot boundary polygons.',
    badge: 'Real Estate',
    simpleMode: false,
    realEstateMode: true,
    autoOpenDrawTools: false,
  },
  {
    id: 'pro_survey',
    label: 'Pro Measure & Survey',
    shortLabel: 'Survey',
    description:
      'Unlocks expanded draw, polygon, and distance/area measurement tools for land & routes.',
    badge: 'GIS Tools',
    simpleMode: false,
    realEstateMode: false,
    autoOpenDrawTools: true,
  },
] as const;

interface PlatformSettings {
  maintenanceNotice: string;
  requirePanoramaForRealEstate: boolean;
  defaultAreaUnit: AreaUnit;
  dataRetentionDays: number;
  enablePublicEnquiries: boolean;
  enablePublicReviews: boolean;
  sponsoredSlotsEnabledDemo: boolean;
  show_sample_data?: boolean;
}

interface AppContextValue {
  // Configurable Default Map Centre (Step 4F-B & Phase 49-Y)
  customDefaultCenter: LatLngPoint | null;
  customDefaultZoom: number;
  effectiveDefaultCenter: LatLngPoint;
  setCustomDefaultCenter: (coords: LatLngPoint, zoom?: number) => void;
  resetCustomDefaultCenter: () => void;
  currentMapCenter: LatLngPoint;
  setCurrentMapCenter: (coords: LatLngPoint) => void;

  // Active Simulated Identity & Workspace
  currentUser: UserAccount;
  switchUser: (userId: string) => void;
  users: UserAccount[];
  updateUserRoleOrStatus: (
    userId: string,
    updates: Partial<Pick<UserAccount, 'roleType' | 'adminRole' | 'status'>>
  ) => { ok: boolean; message: string };

  // Website Theme & Independent Map Appearance (Never coupled)
  appearanceMode: AppearanceMode;
  setAppearanceMode: (mode: AppearanceMode) => void;
  themePreset: ThemePreset;
  setThemePreset: (preset: ThemePreset) => void;
  resetThemeToDefault: () => void;
  mapStyle: MapStyleOption;
  setMapStyle: (style: MapStyleOption) => void;
  mapAppearance: MapAppearanceVariant;
  setMapAppearance: (variant: MapAppearanceVariant) => void;
  configuredMapId: string;
  configuredLightMapId: string;
  configuredDarkMapId: string;
  setConfiguredMapIds: (ids: {
    mapId?: string;
    lightMapId?: string;
    darkMapId?: string;
  }) => void;
  mapCloudFallbackNotice: string | null;
  useVectorStylePreview: boolean;
  setUseVectorStylePreview: (val: boolean) => void;

  // Global Area Unit (default strictly 'sqm' / m²)
  areaUnit: AreaUnit;
  setAreaUnit: (unit: AreaUnit) => void;

  // Coherent Data Records & Simulated Async Lifecycle (Phase 1-B)
  listings: Listing[];
  isLoading: boolean;
  isFetching: boolean;
  setIsFetching: (fetching: boolean) => void;
  isMoving: boolean;
  setIsMoving: (moving: boolean) => void;
  error: string | null;
  retryFetchListings: () => Promise<void>;
  savedListingIds: string[];
  toggleSavedListing: (listingId: string) => void;
  recordListingInteraction: (
    listingId: string,
    metric: 'viewsCount' | 'detailVisitsCount' | 'directionClicksCount'
  ) => void;

  // Listing CRUD (Owner, Staff, Admin)
  saveListing: (
    listing: Listing,
    targetStatus?: ListingStatus
  ) => { ok: boolean; message: string };
  duplicateListing: (listingId: string) => Listing | null;
  changeListingStatus: (
    listingId: string,
    status: ListingStatus,
    note?: string
  ) => { ok: boolean; message: string };
  restoreListingVersion: (listingId: string, versionId: string) => void;
  updateListingCoordinates: (
    listingId: string,
    coords: LatLngPoint,
    locality?: string
  ) => { ok: boolean; message: string };
  bulkUpdateListingStatus: (
    listingIds: string[],
    status: ListingStatus
  ) => { updated: number; blocked: number; permissionDenied?: boolean; message?: string };
  importListingsBatch: (newListings: Listing[]) => {
    imported: number;
    draftsWithoutPanorama: number;
  };

  // Catalogue CRUD
  saveCatalogueProduct: (listingId: string, product: CatalogueProduct) => void;
  deleteCatalogueProduct: (listingId: string, productId: string) => void;

  // Enquiries & Reviews
  enquiries: EnquiryRecord[];
  submitVisitorEnquiry: (
    payload: Omit<EnquiryRecord, 'id' | 'createdAt' | 'status' | 'activityLog'>
  ) => void;
  replyToEnquiry: (
    enquiryId: string,
    replyText: string,
    status: EnquiryRecord['status']
  ) => void;

  reviews: ReviewRecord[];
  submitVisitorReview: (
    listingId: string,
    authorName: string,
    rating: number,
    comment: string
  ) => void;
  replyToReview: (reviewId: string, replyText: string) => void;
  reportReview: (reviewId: string, reason: string) => void;

  // Staff Delegation
  staffDelegations: StaffDelegation[];
  saveStaffDelegation: (delegation: StaffDelegation) => void;
  revokeStaffDelegation: (delegationId: string) => void;
  hasStaffPermission: (listingId: string, permission: StaffPermission) => boolean;

  // Admin Workflows
  verificationRequests: VerificationRequest[];
  decideVerificationRequest: (
    requestId: string,
    status: VerificationRequest['status'],
    reason: string
  ) => void;
  moderationCases: ModerationCase[];
  decideModerationCase: (
    caseId: string,
    status: ModerationCase['status'],
    note: string
  ) => void;
  dynamicFields: DynamicFieldDefinition[];
  saveDynamicField: (field: DynamicFieldDefinition) => void;
  deleteDynamicField: (fieldId: string) => void;

  // Drawn Map Shapes (with Undo / Redo & persistence)
  drawnShapes: DrawnShape[];
  setDrawnShapes: React.Dispatch<React.SetStateAction<DrawnShape[]>>;
  undoDrawnShapes: () => void;
  redoDrawnShapes: () => void;
  canUndoDrawing: boolean;
  canRedoDrawing: boolean;

  // Notifications, Audit & Settings
  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  auditLogs: AuditLogEntry[];
  platformSettings: PlatformSettings;
  updatePlatformSettings: (updates: Partial<PlatformSettings>) => void;

  // Reset Demo Data
  resetDemoData: () => void;

  // Maps Quota Warning State (Tier 1 & Tier 2)
  mapsQuotaExceeded: boolean;
}

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  maintenanceNotice: '',
  requirePanoramaForRealEstate: true,
  defaultAreaUnit: DEFAULT_AREA_UNIT,
  dataRetentionDays: 90,
  enablePublicEnquiries: true,
  enablePublicReviews: true,
  sponsoredSlotsEnabledDemo: true,
  show_sample_data: true,
};

const AppContext = createContext<AppContextValue | null>(null);

if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (ev: ErrorEvent) => {
      const msg = String(ev.message || '');
      const src = String(ev.filename || '');
      if (
        msg.includes('Could not find a 3d context') ||
        (src.includes('maps.googleapis.com') && src.includes('webgl.js'))
      ) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
    },
    true
  );
}

const DEFAULT_VISITOR_ACCOUNT: UserAccount = {
  id: 'visitor-guest',
  name: 'Guest Visitor',
  email: '',
  roleType: 'visitor',
  status: 'active',
  joinedAt: new Date().toISOString().slice(0, 10),
  avatarLabel: 'GV',
  description: 'Public directory visitor',
};

function AppProviderInner({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('visitor-guest');

  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>('light');
  const [themePreset, setThemePresetState] = useState<ThemePreset>('neutral');
  const [mapStyle, setMapStyleState] = useState<MapStyleOption>('roadmap');
  const [mapAppearance, setMapAppearanceState] = useState<MapAppearanceVariant>('light');
  const [configuredMapId, setConfiguredMapId] = useState<string>(
    sanitizeMapId(process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID)
  );
  const [configuredLightMapId, setConfiguredLightMapId] = useState<string>(
    sanitizeMapId(process.env.NEXT_PUBLIC_GOOGLE_MAPS_LIGHT_MAP_ID)
  );
  const [configuredDarkMapId, setConfiguredDarkMapId] = useState<string>(
    sanitizeMapId(process.env.NEXT_PUBLIC_GOOGLE_MAPS_DARK_MAP_ID)
  );
  const [mapCloudFallbackNotice, setMapCloudFallbackNotice] = useState<string | null>(null);
  const [useVectorStylePreview, setUseVectorStylePreview] = useState<boolean>(false);
  const [areaUnit, setAreaUnit] = useState<AreaUnit>(DEFAULT_AREA_UNIT);

  // Step 4F-B & Phase 49-Y: Configurable Default Map Centre & Zoom
  const [customDefaultCenter, setCustomDefaultCenterState] =
    useState<LatLngPoint | null>(null);
  const [customDefaultZoom, setCustomDefaultZoomState] = useState<number>(13);
  const [currentMapCenter, setCurrentMapCenter] = useState<LatLngPoint>(
    CHURACHANDPUR_SAMPLE_CENTER
  );
  const effectiveDefaultCenter = useMemo(
    () => customDefaultCenter || CHURACHANDPUR_SAMPLE_CENTER,
    [customDefaultCenter]
  );
  const setCustomDefaultCenter = useCallback(
    (coords: LatLngPoint, zoom?: number) => {
      const sanitized: LatLngPoint = {
        lat: Number(coords.lat.toFixed(6)),
        lng: Number(coords.lng.toFixed(6)),
      };
      setCustomDefaultCenterState(sanitized);
      if (typeof zoom === 'number' && Number.isFinite(zoom)) {
        setCustomDefaultZoomState(Math.min(20, Math.max(3, Math.round(zoom))));
      }
      try {
        localStorage.setItem(
          STORAGE_KEY_CUSTOM_DEFAULT_CENTER,
          JSON.stringify({
            ...sanitized,
            ...(typeof zoom === 'number' && Number.isFinite(zoom)
              ? { zoom: Math.round(zoom) }
              : {}),
          })
        );
      } catch {
        // ignore quota errors
      }
    },
    []
  );
  const resetCustomDefaultCenter = useCallback(() => {
    setCustomDefaultCenterState(null);
    setCustomDefaultZoomState(13);
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_DEFAULT_CENTER);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      document.cookie = 'ps_map_settings=; path=/; max-age=0; samesite=lax';
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleMapSettingsUpdated = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{ lat?: number; lng?: number; zoom?: number } | null>
      ).detail;
      if (
        detail &&
        typeof detail.lat === 'number' &&
        typeof detail.lng === 'number'
      ) {
        setCustomDefaultCenterState({
          lat: Number(detail.lat.toFixed(6)),
          lng: Number(detail.lng.toFixed(6)),
        });
        if (typeof detail.zoom === 'number' && Number.isFinite(detail.zoom)) {
          setCustomDefaultZoomState(
            Math.min(20, Math.max(3, Math.round(detail.zoom)))
          );
        }
      }
    };
    window.addEventListener(
      'printswift:map-settings-updated',
      handleMapSettingsUpdated
    );
    return () => {
      window.removeEventListener(
        'printswift:map-settings-updated',
        handleMapSettingsUpdated
      );
    };
  }, []);

  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [isMoving, setIsMoving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedListingIds, setSavedListingIds] = useState<string[]>([]);
  const [enquiries, setEnquiries] = useState<EnquiryRecord[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [staffDelegations, setStaffDelegations] = useState<StaffDelegation[]>([]);
  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>([]);
  const [moderationCases, setModerationCases] = useState<ModerationCase[]>([]);
  const [dynamicFields, setDynamicFields] = useState<DynamicFieldDefinition[]>([]);
  const [drawingState, setDrawingState] = useState<{
    present: DrawnShape[];
    past: DrawnShape[][];
    future: DrawnShape[][];
  }>({
    present: [],
    past: [],
    future: [],
  });
  const drawnShapes = drawingState.present;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(
    DEFAULT_PLATFORM_SETTINGS
  );
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Tier 1 & Tier 2 Google Maps Quota & Cloud Map ID Fallback Defense Listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).gm_authFailure = () => {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    };
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      const msg = args
        .map((a) => {
          if (typeof a === 'string') return a;
          if (a instanceof Error) return a.message;
          return '';
        })
        .join(' ');
      if (
        msg.includes('params are being enumerated') ||
        msg.includes('keys of `searchParams` were accessed directly') ||
        msg.includes('`params` should be unwrapped with `React.use()`') ||
        msg.includes('`searchParams` should be unwrapped with `React.use()`')
      ) {
        return;
      }
      if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
        origError.apply(console, args);
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        return;
      }
      if (msg.includes('ApiProjectMapError')) {
        // Invalid custom Map ID: fall back to DEMO_MAP_ID gracefully
        window.dispatchEvent(
          new CustomEvent('gmp-mapid-fallback', {
            detail:
              'Custom Map ID was not recognised by this Google Cloud project. Automatically reverted to DEMO_MAP_ID fallback.',
          })
        );
        return;
      }
      if (msg.includes('BillingNotEnabledMapError')) {
        window.dispatchEvent(
          new CustomEvent('gmp-mapid-fallback', {
            detail:
              'Google Cloud Billing is not yet enabled on the active API key project (BillingNotEnabledMapError). Switched to DD oodle Cloud-Style Vector Preview fallback until Cloud Billing is active.',
          })
        );
        return;
      }
      if (
        msg.includes(
          'Attempted to load a Vector Map, but failed. Falling back to Raster'
        ) ||
        msg.includes('Could not find a 3d context')
      ) {
        // Headless browser without GPU WebGL2 support automatically falls back to Raster tiles
        console.info('[Google Maps] WebGL Vector fallback to Raster active.');
        return;
      }
      origError.apply(console, args);
    };
    const handleQuota = () => setMapsQuotaExceeded(true);
    const handleMapIdFallback = (ev: Event) => {
      const customEv = ev as CustomEvent<string>;
      const detailMsg = customEv.detail || 'Map ID or billing fallback triggered.';
      setMapCloudFallbackNotice(detailMsg);
      if (detailMsg.includes('ApiProjectMapError') || detailMsg.includes('Custom Map ID')) {
        setConfiguredMapId('DEMO_MAP_ID');
        setConfiguredLightMapId('');
        setConfiguredDarkMapId('');
      }
      if (detailMsg.includes('BillingNotEnabledMapError')) {
        setUseVectorStylePreview(true);
      }
    };
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    window.addEventListener('gmp-mapid-fallback', handleMapIdFallback);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuota);
      window.removeEventListener('gmp-mapid-fallback', handleMapIdFallback);
      console.error = origError;
    };
  }, []);

  // Hydrate from localStorage on mount
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
        if (savedTheme) {
          const parsedTheme = JSON.parse(savedTheme);
          if (parsedTheme.appearanceMode) setAppearanceModeState(parsedTheme.appearanceMode);
          if (parsedTheme.themePreset) setThemePresetState(parsedTheme.themePreset);
        }
        const savedMapStyle = localStorage.getItem(STORAGE_KEY_MAP_STYLE) as MapStyleOption | null;
        if (savedMapStyle) {
          setMapStyleState(savedMapStyle);
          if (savedMapStyle === 'dark') {
            setMapAppearanceState('dark');
          }
        }
        const savedCloudCfg = localStorage.getItem(STORAGE_KEY_MAP_CLOUD_CONFIG);
        if (savedCloudCfg) {
          const parsedCfg = JSON.parse(savedCloudCfg);
          if (parsedCfg.mapAppearance === 'light' || parsedCfg.mapAppearance === 'dark') {
            setMapAppearanceState(parsedCfg.mapAppearance);
          }
          if (typeof parsedCfg.configuredMapId === 'string') {
            setConfiguredMapId(sanitizeMapId(parsedCfg.configuredMapId));
          }
          if (typeof parsedCfg.configuredLightMapId === 'string') {
            setConfiguredLightMapId(sanitizeMapId(parsedCfg.configuredLightMapId));
          }
          if (typeof parsedCfg.configuredDarkMapId === 'string') {
            setConfiguredDarkMapId(sanitizeMapId(parsedCfg.configuredDarkMapId));
          }
        }
        const savedData = localStorage.getItem(STORAGE_KEY_STATE);
        if (savedData) {
          const parsed = JSON.parse(savedData);
          if (Array.isArray(parsed.users)) setUsers(parsed.users);
          if (parsed.currentUserId) setCurrentUserId(parsed.currentUserId);
          if (Array.isArray(parsed.savedListingIds)) setSavedListingIds(parsed.savedListingIds);
          if (Array.isArray(parsed.enquiries)) setEnquiries(parsed.enquiries);
          if (Array.isArray(parsed.reviews)) setReviews(parsed.reviews);
          if (Array.isArray(parsed.staffDelegations)) setStaffDelegations(parsed.staffDelegations);
          if (Array.isArray(parsed.verificationRequests))
            setVerificationRequests(parsed.verificationRequests);
          if (Array.isArray(parsed.moderationCases)) setModerationCases(parsed.moderationCases);
          if (Array.isArray(parsed.dynamicFields)) setDynamicFields(parsed.dynamicFields);
          if (Array.isArray(parsed.drawnShapes)) {
            setDrawingState({
              present: parsed.drawnShapes,
              past: [],
              future: [],
            });
          }
          if (Array.isArray(parsed.auditLogs)) setAuditLogs(parsed.auditLogs);
          if (parsed.platformSettings) setPlatformSettings(parsed.platformSettings);
        }
        const savedDrawnShapes = localStorage.getItem(STORAGE_KEY_DRAWN_SHAPES);
        if (savedDrawnShapes) {
          const parsedShapes = JSON.parse(savedDrawnShapes);
          if (Array.isArray(parsedShapes)) {
            setDrawingState({
              present: parsedShapes,
              past: [],
              future: [],
            });
          }
        }
        let hydratedCenterFromCookie = false;
        if (typeof document !== 'undefined') {
          const cookieMatch = document.cookie
            .split('; ')
            .find((row) => row.startsWith('ps_map_settings='));
          if (cookieMatch) {
            try {
              const decoded = JSON.parse(
                decodeURIComponent(cookieMatch.split('=')[1] || '')
              ) as { lat?: number; lng?: number; zoom?: number; configured?: boolean };
              if (
                decoded?.configured &&
                typeof decoded?.lat === 'number' &&
                typeof decoded?.lng === 'number' &&
                !isNaN(decoded.lat) &&
                !isNaN(decoded.lng)
              ) {
                setCustomDefaultCenterState({ lat: decoded.lat, lng: decoded.lng });
                if (typeof decoded.zoom === 'number' && Number.isFinite(decoded.zoom)) {
                  setCustomDefaultZoomState(
                    Math.min(20, Math.max(3, Math.round(decoded.zoom)))
                  );
                }
                hydratedCenterFromCookie = true;
              }
            } catch {
              // ignore malformed cookie
            }
          }
        }
        if (!hydratedCenterFromCookie) {
          const savedCustomCenter = localStorage.getItem(
            STORAGE_KEY_CUSTOM_DEFAULT_CENTER
          );
          if (savedCustomCenter) {
            const parsed = JSON.parse(savedCustomCenter);
            if (
              typeof parsed?.lat === 'number' &&
              typeof parsed?.lng === 'number' &&
              !isNaN(parsed.lat) &&
              !isNaN(parsed.lng)
            ) {
              setCustomDefaultCenterState({ lat: parsed.lat, lng: parsed.lng });
              if (typeof parsed?.zoom === 'number' && Number.isFinite(parsed.zoom)) {
                setCustomDefaultZoomState(
                  Math.min(20, Math.max(3, Math.round(parsed.zoom)))
                );
              }
            }
          }
        }
      } catch {
        // Ignore storage parse error and keep seed state
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  // Phase 5: Strictly rely on live Supabase fetchPublishedListings()
  const loadLivePublishedListings = useCallback(async (): Promise<Listing[]> => {
    return await fetchPublishedListings();
  }, []);

  const retryFetchListings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadLivePublishedListings();
      setListings(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load directory listings. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [loadLivePublishedListings]);

  useEffect(() => {
    let active = true;
    loadLivePublishedListings()
      .then((data) => {
        if (!active) return;
        setListings(data);
        setError(null);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load directory listings. Please try again.'
        );
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadLivePublishedListings]);

  // Phase 32: Sync global app_settings (e.g., show_sample_data) from Supabase
  useEffect(() => {
    let active = true;
    fetchAppSettings()
      .then((remoteSettings) => {
        if (!active) return;
        setPlatformSettings((prev) => ({
          ...prev,
          show_sample_data: remoteSettings.show_sample_data !== false,
        }));
      })
      .catch(() => {
        // Fallback to local state
      });

    if (typeof window === 'undefined') {
      return () => {
        active = false;
      };
    }

    const handleSettingsUpdated = (ev: Event) => {
      const customEv = ev as CustomEvent<{ show_sample_data?: boolean }>;
      const nextVal = customEv.detail?.show_sample_data;
      if (typeof nextVal === 'boolean') {
        setPlatformSettings((prev) => ({
          ...prev,
          show_sample_data: nextVal,
        }));
      }
    };
    window.addEventListener(
      'printswift:app-settings-updated',
      handleSettingsUpdated
    );
    return () => {
      active = false;
      window.removeEventListener(
        'printswift:app-settings-updated',
        handleSettingsUpdated
      );
    };
  }, []);

  // Persist state changes
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_DRAWN_SHAPES, JSON.stringify(drawnShapes));
    } catch {
      // Ignore quota errors
    }
    try {
      localStorage.setItem(
        STORAGE_KEY_STATE,
        JSON.stringify({
          listings,
          users,
          currentUserId,
          savedListingIds,
          enquiries,
          reviews,
          staffDelegations,
          verificationRequests,
          moderationCases,
          dynamicFields,
          drawnShapes,
          notifications,
          auditLogs,
          platformSettings,
        })
      );
    } catch {
      // Ignore quota errors on large custom media
    }
  }, [
    hydrated,
    listings,
    users,
    currentUserId,
    savedListingIds,
    enquiries,
    reviews,
    staffDelegations,
    verificationRequests,
    moderationCases,
    dynamicFields,
    drawnShapes,
    notifications,
    auditLogs,
    platformSettings,
  ]);

  // Apply Website Theme independently of Map Style
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme-preset', themePreset);

    const applyMode = (mode: AppearanceMode) => {
      if (mode === 'dark') {
        root.classList.add('dark');
      } else if (mode === 'light') {
        root.classList.remove('dark');
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', prefersDark);
      }
    };
    applyMode(appearanceMode);

    if (hydrated) {
      localStorage.setItem(
        STORAGE_KEY_THEME,
        JSON.stringify({ appearanceMode, themePreset })
      );
    }

    if (appearanceMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e: MediaQueryListEvent) => {
        root.classList.toggle('dark', e.matches);
      };
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
  }, [appearanceMode, themePreset, hydrated]);

  const setAppearanceMode = useCallback((mode: AppearanceMode) => {
    setAppearanceModeState(mode);
  }, []);

  const setThemePreset = useCallback((preset: ThemePreset) => {
    setThemePresetState(preset);
  }, []);

  const resetThemeToDefault = useCallback(() => {
    setAppearanceModeState('light');
    setThemePresetState('neutral');
  }, []);

  const setMapStyle = useCallback(
    (style: MapStyleOption) => {
      setMapStyleState(style);
      const nextAppearance: MapAppearanceVariant =
        style === 'dark'
          ? 'dark'
          : style === 'roadmap'
            ? 'light'
            : mapAppearance;
      if (style === 'dark' || style === 'roadmap') {
        setMapAppearanceState(nextAppearance);
      }
      try {
        localStorage.setItem(STORAGE_KEY_MAP_STYLE, style);
        localStorage.setItem(
          STORAGE_KEY_MAP_CLOUD_CONFIG,
          JSON.stringify({
            mapAppearance: nextAppearance,
            configuredMapId,
            configuredLightMapId,
            configuredDarkMapId,
          })
        );
      } catch {
        // ignore
      }
    },
    [mapAppearance, configuredMapId, configuredLightMapId, configuredDarkMapId]
  );

  const setMapAppearance = useCallback(
    (variant: MapAppearanceVariant) => {
      setMapAppearanceState(variant);
      setMapStyleState((prev) => {
        const nextStyle =
          prev === 'roadmap' || prev === 'dark'
            ? variant === 'dark'
              ? 'dark'
              : 'roadmap'
            : prev;
        try {
          localStorage.setItem(STORAGE_KEY_MAP_STYLE, nextStyle);
        } catch {
          // ignore
        }
        return nextStyle;
      });
      try {
        localStorage.setItem(
          STORAGE_KEY_MAP_CLOUD_CONFIG,
          JSON.stringify({
            mapAppearance: variant,
            configuredMapId,
            configuredLightMapId,
            configuredDarkMapId,
          })
        );
      } catch {
        // ignore
      }
    },
    [configuredMapId, configuredLightMapId, configuredDarkMapId]
  );

  const setConfiguredMapIds = useCallback(
    (ids: { mapId?: string; lightMapId?: string; darkMapId?: string }) => {
      const nextPrimary =
        ids.mapId !== undefined ? sanitizeMapId(ids.mapId) : configuredMapId;
      const nextLight =
        ids.lightMapId !== undefined
          ? sanitizeMapId(ids.lightMapId)
          : configuredLightMapId;
      const nextDark =
        ids.darkMapId !== undefined
          ? sanitizeMapId(ids.darkMapId)
          : configuredDarkMapId;
      setConfiguredMapId(nextPrimary);
      setConfiguredLightMapId(nextLight);
      setConfiguredDarkMapId(nextDark);
      setMapCloudFallbackNotice(null);
      try {
        localStorage.setItem(
          STORAGE_KEY_MAP_CLOUD_CONFIG,
          JSON.stringify({
            mapAppearance,
            configuredMapId: nextPrimary,
            configuredLightMapId: nextLight,
            configuredDarkMapId: nextDark,
          })
        );
      } catch {
        // ignore
      }
    },
    [mapAppearance, configuredMapId, configuredLightMapId, configuredDarkMapId]
  );

  const {
    user: activeAuthUser,
    role: syncedProfileRole,
    fullName: syncedProfileFullName,
  } = useSupabaseAuthStore();

  // Phase 34 & 35: Sync live notifications & real-time WebSocket INSERT subscriptions for global unread badge
  useEffect(() => {
    let active = true;
    const syncNotifications = () => {
      fetchMyNotifications(activeAuthUser?.id)
        .then((rows) => {
          if (!active) return;
          setNotifications(rows);
        })
        .catch(() => {
          if (!active) return;
          setNotifications([]);
        });
    };

    syncNotifications();

    const unsubscribeRealtime = activeAuthUser?.id
      ? subscribeToMyNotifications(activeAuthUser.id, (incoming) => {
          if (!active) return;
          setNotifications((prev) =>
            prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]
          );
        })
      : () => {};

    if (typeof window === 'undefined') {
      return () => {
        active = false;
        unsubscribeRealtime();
      };
    }

    const handleNotificationsUpdated = (ev: Event) => {
      const customEv = ev as CustomEvent<{
        insertedNotification?: LiveNotificationRecord;
        markedReadId?: string;
      }>;
      if (customEv.detail?.insertedNotification) {
        const incoming = customEv.detail.insertedNotification;
        setNotifications((prev) =>
          prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]
        );
        return;
      }
      if (customEv.detail?.markedReadId) {
        const targetId = customEv.detail.markedReadId;
        setNotifications((prev) =>
          prev.map((n) => (n.id === targetId ? { ...n, read: true } : n))
        );
        return;
      }
      syncNotifications();
    };
    window.addEventListener(
      'printswift:notifications-updated',
      handleNotificationsUpdated
    );
    return () => {
      active = false;
      unsubscribeRealtime();
      window.removeEventListener(
        'printswift:notifications-updated',
        handleNotificationsUpdated
      );
    };
  }, [activeAuthUser?.id]);

  const currentUser = useMemo<UserAccount>(() => {
    const baseAccount =
      users.find((u) => u.id === currentUserId) ||
      users[0] ||
      DEFAULT_VISITOR_ACCOUNT;

    if (!activeAuthUser) {
      return baseAccount;
    }

    const normalizedRole = (syncedProfileRole || 'visitor').toLowerCase();
    const resolvedRoleType: UserAccount['roleType'] = ADMIN_AUTHORIZED_ROLES.has(
      normalizedRole
    )
      ? 'admin'
      : normalizedRole === 'owner'
        ? 'owner'
        : normalizedRole === 'staff'
          ? 'staff'
          : 'visitor';

    const resolvedAdminRole: AdminRole | undefined =
      normalizedRole === 'super_admin' ||
      normalizedRole === 'listing_moderator' ||
      normalizedRole === 'verification_officer' ||
      normalizedRole === 'community_moderator' ||
      normalizedRole === 'customer_support' ||
      normalizedRole === 'finance_admin' ||
      normalizedRole === 'analytics_viewer'
        ? (normalizedRole as AdminRole)
        : normalizedRole === 'admin'
          ? 'super_admin'
          : undefined;

    const resolvedName =
      syncedProfileFullName ||
      (activeAuthUser.user_metadata?.full_name as string | undefined) ||
      (activeAuthUser.email ? activeAuthUser.email.split('@')[0] : '') ||
      baseAccount.name;

    return {
      ...baseAccount,
      id: activeAuthUser.id || baseAccount.id,
      name: resolvedName,
      email: activeAuthUser.email || baseAccount.email,
      roleType: resolvedRoleType,
      adminRole: resolvedAdminRole,
      avatarLabel:
        resolvedName
          .split(' ')
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase() || baseAccount.avatarLabel,
    };
  }, [
    users,
    currentUserId,
    activeAuthUser,
    syncedProfileRole,
    syncedProfileFullName,
  ]);

  const appendAudit = useCallback(
    (action: string, details: string, targetId?: string, targetName?: string) => {
      const entry: AuditLogEntry = {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.adminRole || currentUser.roleType,
        workspace: currentUser.roleType,
        action,
        targetId,
        targetName,
        details,
      };
      setAuditLogs((prev) => [entry, ...prev]);
    },
    [currentUser]
  );

  const switchUser = useCallback((userId: string) => {
    setCurrentUserId(userId);
  }, []);

  const updateUserRoleOrStatus = useCallback(
    (
      userId: string,
      updates: Partial<Pick<UserAccount, 'roleType' | 'adminRole' | 'status'>>
    ): { ok: boolean; message: string } => {
      if (!canAdminPerformAction(currentUser, 'manage_users')) {
        const msg = `Permission denied: Role "${currentUser.adminRole || currentUser.roleType}" is not authorised to modify user accounts or roles (requires super_admin).`;
        appendAudit('Blocked Unauthorized Action', msg, userId);
        return { ok: false, message: msg };
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, ...updates } : u))
      );
      appendAudit(
        'Updated User Role / Status',
        `Changed user ${userId} attributes: ${JSON.stringify(updates)}`,
        userId
      );
      return { ok: true, message: `Updated user ${userId}.` };
    },
    [currentUser, appendAudit]
  );

  // Phase 49-P: Sync savedListingIds with Supabase profiles.saved_listing_ids
  const activeAuthUserId = activeAuthUser?.id || '';

  useEffect(() => {
    if (!activeAuthUserId || !isSupabaseConfigured()) return;
    let active = true;

    const syncRemoteBookmarks = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('saved_listing_ids')
          .eq('id', activeAuthUserId)
          .maybeSingle();

        if (!active || !data) return;
        const rawIds = (data as { saved_listing_ids?: unknown }).saved_listing_ids;
        if (Array.isArray(rawIds)) {
          const validIds = rawIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          );
          setSavedListingIds(validIds);
        }
      } catch {
        // Ignore non-fatal bookmark fetch error
      }
    };

    void syncRemoteBookmarks();

    return () => {
      active = false;
    };
  }, [activeAuthUserId]);

  const toggleSavedListing = useCallback(
    (listingId: string) => {
      setSavedListingIds((prev) => {
        const exists = prev.includes(listingId);
        const next = exists
          ? prev.filter((id) => id !== listingId)
          : [...prev, listingId];
        setListings((curr) =>
          curr.map((l) =>
            l.id === listingId
              ? {
                  ...l,
                  followsCount: Math.max(0, l.followsCount + (exists ? -1 : 1)),
                }
              : l
          )
        );

        try {
          const raw = localStorage.getItem(STORAGE_KEY_STATE);
          const parsed = raw ? JSON.parse(raw) : {};
          localStorage.setItem(
            STORAGE_KEY_STATE,
            JSON.stringify({ ...parsed, savedListingIds: next })
          );
        } catch {
          // Ignore storage quota errors
        }

        if (activeAuthUserId && isSupabaseConfigured()) {
          void supabase
            .from('profiles')
            .update({ saved_listing_ids: next })
            .eq('id', activeAuthUserId)
            .then(() => {
              emitBookmarkChange();
            });
        }

        queueMicrotask(() => {
          emitBookmarkChange();
        });

        return next;
      });
    },
    [activeAuthUserId]
  );

  const recordListingInteraction = useCallback(
    (
      listingId: string,
      metric: 'viewsCount' | 'detailVisitsCount' | 'directionClicksCount'
    ) => {
      setListings((prev) =>
        prev.map((l) =>
          l.id === listingId ? { ...l, [metric]: (l[metric] || 0) + 1 } : l
        )
      );
    },
    []
  );

  const hasStaffPermission = useCallback(
    (listingId: string, permission: StaffPermission): boolean => {
      if (currentUser.roleType === 'admin' || currentUser.roleType === 'owner') {
        return true;
      }
      if (currentUser.roleType !== 'staff') return false;
      return staffDelegations.some(
        (d) =>
          d.staffUserId === currentUser.id &&
          d.status === 'active' &&
          d.assignedListingIds.includes(listingId) &&
          d.permissions.includes(permission)
      );
    },
    [currentUser, staffDelegations]
  );

  const saveListing = useCallback(
    (
      incoming: Listing,
      targetStatus?: ListingStatus
    ): { ok: boolean; message: string } => {
      const desiredStatus = targetStatus || incoming.status;
      const cleaned: Listing = {
        ...incoming,
        updatedAt: new Date().toISOString(),
      };

      if (cleaned.category === 'real_estate' && cleaned.realEstateDetails) {
        cleaned.realEstateDetails = sanitizeRealEstateForPropertyType(
          cleaned.realEstateDetails
        );
      }

      // Real-estate 360° panorama is recommended for richer previews, not a submission blocker

      cleaned.status = desiredStatus;
      const snapshot = {
        versionId: `${cleaned.id}-v-${Date.now()}`,
        timestamp: cleaned.updatedAt,
        editorName: currentUser.name,
        editorRole: currentUser.roleType,
        summary: `Saved listing (${desiredStatus})`,
        title: cleaned.title,
        description: cleaned.description,
        status: desiredStatus,
        coordinates: cleaned.coordinates,
      };
      cleaned.versionHistory = [snapshot, ...(cleaned.versionHistory || [])];

      setListings((prev) => {
        const exists = prev.some((item) => item.id === cleaned.id);
        if (exists) {
          return prev.map((item) => (item.id === cleaned.id ? cleaned : item));
        }
        return [cleaned, ...prev];
      });

      if (currentUser.roleType === 'staff') {
        setStaffDelegations((prev) =>
          prev.map((del) =>
            del.staffUserId === currentUser.id &&
            del.status === 'active' &&
            !del.assignedListingIds.includes(cleaned.id)
              ? {
                  ...del,
                  assignedListingIds: [cleaned.id, ...del.assignedListingIds],
                }
              : del
          )
        );
      }

      appendAudit(
        'Saved Listing',
        `Saved listing "${cleaned.title}" with status "${desiredStatus}".`,
        cleaned.id,
        cleaned.title
      );

      return {
        ok: true,
        message:
          desiredStatus === 'draft'
            ? 'Draft listing saved to local prototype repository.'
            : `Listing "${cleaned.title}" saved with status "${desiredStatus.replace(/_/g, ' ')}".`,
      };
    },
    [currentUser, appendAudit]
  );

  const duplicateListing = useCallback(
    (listingId: string): Listing | null => {
      const source = listings.find((l) => l.id === listingId);
      if (!source) return null;
      const copy: Listing = {
        ...JSON.parse(JSON.stringify(source)),
        id: `${source.category.slice(0, 3)}-copy-${Date.now()}`,
        title: `${source.title} (Copy)`,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setListings((prev) => [copy, ...prev]);
      appendAudit(
        'Duplicated Listing',
        `Created draft copy from "${source.title}".`,
        copy.id,
        copy.title
      );
      return copy;
    },
    [listings, appendAudit]
  );

  const changeListingStatus = useCallback(
    (
      listingId: string,
      status: ListingStatus,
      note?: string
    ): { ok: boolean; message: string } => {
      const target = listings.find((l) => l.id === listingId);
      if (!target) return { ok: false, message: 'Listing not found.' };

      if (
        currentUser.roleType === 'admin' &&
        !canAdminPerformAction(currentUser, 'manage_listings')
      ) {
        const msg = `Permission denied: Admin role "${currentUser.adminRole}" is not authorised to change listing status.`;
        appendAudit('Blocked Unauthorized Action', msg, listingId, target.title);
        return { ok: false, message: msg };
      }

      if (
        target.category === 'real_estate' &&
        (status === 'submitted' ||
          status === 'pending_verification' ||
          status === 'published') &&
        !hasValidMandatoryPanorama(target)
      ) {
        return {
          ok: false,
          message:
            'Cannot publish or submit real-estate listing without at least one valid 360° equirectangular panorama.',
        };
      }

      setListings((prev) =>
        prev.map((l) =>
          l.id === listingId
            ? {
                ...l,
                status,
                changeRequestNote: note !== undefined ? note : l.changeRequestNote,
                updatedAt: new Date().toISOString(),
              }
            : l
        )
      );

      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          recipientRole: currentUser.roleType === 'admin' ? 'owner' : 'admin',
          title: `Listing Status Updated: ${status.replace(/_/g, ' ')}`,
          message: `"${target.title}" is now marked as ${status.replace(/_/g, ' ')}.${note ? ` Note: ${note}` : ''}`,
          type: 'status_change',
          createdAt: new Date().toISOString(),
          read: false,
          linkListingId: listingId,
        },
        ...prev,
      ]);

      appendAudit(
        'Changed Listing Status',
        `Status changed to "${status}"${note ? ` (${note})` : ''}`,
        listingId,
        target.title
      );
      return { ok: true, message: `Status updated to ${status.replace(/_/g, ' ')}.` };
    },
    [listings, currentUser, appendAudit]
  );

  const restoreListingVersion = useCallback(
    (listingId: string, versionId: string) => {
      setListings((prev) =>
        prev.map((l) => {
          if (l.id !== listingId) return l;
          const ver = l.versionHistory.find((v) => v.versionId === versionId);
          if (!ver) return l;
          return {
            ...l,
            title: ver.title,
            description: ver.description,
            coordinates: ver.coordinates,
            updatedAt: new Date().toISOString(),
          };
        })
      );
      appendAudit('Restored Listing Version', `Restored version ${versionId}`, listingId);
    },
    [appendAudit]
  );

  const updateListingCoordinates = useCallback(
    (
      listingId: string,
      coords: LatLngPoint,
      locality?: string
    ): { ok: boolean; message: string } => {
      if (
        currentUser.roleType === 'admin' &&
        !canAdminPerformAction(currentUser, 'manage_geography')
      ) {
        const msg = `Permission denied: Admin role "${currentUser.adminRole}" is not authorised to modify geographic pin coordinates.`;
        appendAudit('Blocked Unauthorized Action', msg, listingId);
        return { ok: false, message: msg };
      }
      setListings((prev) =>
        prev.map((l) =>
          l.id === listingId
            ? {
                ...l,
                coordinates: coords,
                locality: locality || l.locality,
                updatedAt: new Date().toISOString(),
              }
            : l
        )
      );
      appendAudit(
        'Geographic Pin Correction',
        `Updated coordinates to (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`,
        listingId
      );
      return { ok: true, message: 'Updated pin coordinates.' };
    },
    [currentUser, appendAudit]
  );

  const bulkUpdateListingStatus = useCallback(
    (
      listingIds: string[],
      status: ListingStatus
    ): {
      updated: number;
      blocked: number;
      permissionDenied?: boolean;
      message?: string;
    } => {
      if (
        currentUser.roleType === 'admin' &&
        !canAdminPerformAction(currentUser, 'manage_listings')
      ) {
        const msg = `Permission denied: Admin role "${currentUser.adminRole}" is not authorised to perform bulk listing status updates.`;
        appendAudit('Blocked Unauthorized Action', msg);
        return { updated: 0, blocked: listingIds.length, permissionDenied: true, message: msg };
      }
      let updated = 0;
      let blocked = 0;
      setListings((prev) =>
        prev.map((l) => {
          if (!listingIds.includes(l.id)) return l;
          if (
            l.category === 'real_estate' &&
            (status === 'published' || status === 'submitted') &&
            !hasValidMandatoryPanorama(l)
          ) {
            blocked++;
            return l;
          }
          updated++;
          return { ...l, status, updatedAt: new Date().toISOString() };
        })
      );
      appendAudit(
        'Bulk Listing Status Update',
        `Updated ${updated} listings to "${status}" (${blocked} blocked by panorama rule).`
      );
      return { updated, blocked };
    },
    [currentUser, appendAudit]
  );

  const importListingsBatch = useCallback(
    (newListings: Listing[]) => {
      let imported = 0;
      let draftsWithoutPanorama = 0;
      const processed = newListings.map((item) => {
        imported++;
        if (item.category === 'real_estate' && !hasValidMandatoryPanorama(item)) {
          draftsWithoutPanorama++;
          return { ...item, status: 'draft' as ListingStatus };
        }
        return item;
      });
      setListings((prev) => [...processed, ...prev]);
      appendAudit(
        'Imported Listings Batch',
        `Imported ${imported} listings (${draftsWithoutPanorama} saved as incomplete drafts due to missing 360° panorama).`
      );
      return { imported, draftsWithoutPanorama };
    },
    [appendAudit]
  );

  const saveCatalogueProduct = useCallback(
    (listingId: string, product: CatalogueProduct) => {
      setListings((prev) =>
        prev.map((l) => {
          if (l.id !== listingId || !l.businessDetails) return l;
          const existing = l.businessDetails.catalogue || [];
          const exists = existing.some((p) => p.id === product.id);
          const nextCat = exists
            ? existing.map((p) => (p.id === product.id ? product : p))
            : [product, ...existing];
          return {
            ...l,
            updatedAt: new Date().toISOString(),
            businessDetails: {
              ...l.businessDetails,
              catalogue: nextCat,
            },
          };
        })
      );
      appendAudit(
        'Saved Catalogue Product',
        `Saved product "${product.name}" on listing ${listingId}`,
        listingId,
        product.name
      );
    },
    [appendAudit]
  );

  const deleteCatalogueProduct = useCallback(
    (listingId: string, productId: string) => {
      setListings((prev) =>
        prev.map((l) => {
          if (l.id !== listingId || !l.businessDetails) return l;
          return {
            ...l,
            updatedAt: new Date().toISOString(),
            businessDetails: {
              ...l.businessDetails,
              catalogue: l.businessDetails.catalogue.filter((p) => p.id !== productId),
            },
          };
        })
      );
      appendAudit('Deleted Catalogue Product', `Removed product ${productId}`, listingId);
    },
    [appendAudit]
  );

  const submitVisitorEnquiry = useCallback(
    (payload: Omit<EnquiryRecord, 'id' | 'createdAt' | 'status' | 'activityLog'>) => {
      const now = new Date().toISOString();
      const record: EnquiryRecord = {
        ...payload,
        id: `enq-${Date.now()}`,
        createdAt: now,
        status: 'open',
        activityLog: [
          {
            id: `act-${Date.now()}`,
            timestamp: now,
            actor: payload.senderName,
            action: `Submitted demonstration enquiry from ${payload.source}.`,
          },
        ],
      };
      setEnquiries((prev) => [record, ...prev]);
      setListings((prev) =>
        prev.map((l) =>
          l.id === payload.listingId
            ? { ...l, enquiriesCount: (l.enquiriesCount || 0) + 1 }
            : l
        )
      );
      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          recipientRole: 'owner',
          title: 'New Demonstration Enquiry',
          message: `${payload.senderName} enquired about "${payload.listingTitle}".`,
          type: 'enquiry',
          createdAt: now,
          read: false,
          linkListingId: payload.listingId,
        },
        ...prev,
      ]);
    },
    []
  );

  const replyToEnquiry = useCallback(
    (enquiryId: string, replyText: string, status: EnquiryRecord['status']) => {
      const now = new Date().toISOString();
      setEnquiries((prev) =>
        prev.map((enq) => {
          if (enq.id !== enquiryId) return enq;
          return {
            ...enq,
            ownerReply: replyText,
            repliedAt: now,
            status,
            activityLog: [
              ...enq.activityLog,
              {
                id: `act-${Date.now()}`,
                timestamp: now,
                actor: currentUser.name,
                action: `Saved demonstration reply and updated status to ${status}.`,
              },
            ],
          };
        })
      );
      appendAudit('Replied to Enquiry', `Updated enquiry ${enquiryId} (${status})`, enquiryId);
    },
    [currentUser, appendAudit]
  );

  const submitVisitorReview = useCallback(
    (listingId: string, authorName: string, rating: number, comment: string) => {
      const target = listings.find((l) => l.id === listingId);
      const rev: ReviewRecord = {
        id: `rev-${Date.now()}`,
        listingId,
        listingTitle: target?.title || 'Sample Listing',
        authorName,
        rating,
        comment,
        createdAt: new Date().toISOString().slice(0, 10),
        reported: false,
        moderationStatus: 'approved',
      };
      setReviews((prev) => [rev, ...prev]);
      setListings((prev) =>
        prev.map((l) => {
          if (l.id !== listingId) return l;
          const nextCount = l.reviewCount + 1;
          const nextRating = Number(
            ((l.rating * l.reviewCount + rating) / nextCount).toFixed(1)
          );
          return { ...l, reviewCount: nextCount, rating: nextRating };
        })
      );
      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          recipientRole: 'owner',
          title: 'New Sample Review Posted',
          message: `${authorName} left a ${rating}★ review on "${target?.title}".`,
          type: 'review',
          createdAt: new Date().toISOString(),
          read: false,
          linkListingId: listingId,
        },
        ...prev,
      ]);
    },
    [listings]
  );

  const replyToReview = useCallback(
    (reviewId: string, replyText: string) => {
      const today = new Date().toISOString().slice(0, 10);
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? { ...r, ownerReply: replyText, ownerReplyUpdatedAt: today }
            : r
        )
      );
      appendAudit('Saved Review Reply', `Replied to review ${reviewId}`, reviewId);
    },
    [appendAudit]
  );

  const reportReview = useCallback(
    (reviewId: string, reason: string) => {
      const target = reviews.find((r) => r.id === reviewId);
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? { ...r, reported: true, reportReason: reason, moderationStatus: 'flagged' }
            : r
        )
      );
      if (target) {
        setModerationCases((prev) => [
          {
            id: `mod-${Date.now()}`,
            targetType: 'review',
            targetId: reviewId,
            targetTitle: `Review by ${target.authorName} on ${target.listingTitle}`,
            reason,
            reportedBy: currentUser.name,
            createdAt: new Date().toISOString(),
            status: 'open',
          },
          ...prev,
        ]);
      }
      appendAudit('Reported Review', `Flagged review ${reviewId}: ${reason}`, reviewId);
    },
    [reviews, currentUser, appendAudit]
  );

  const saveStaffDelegation = useCallback(
    (delegation: StaffDelegation) => {
      setStaffDelegations((prev) => {
        const exists = prev.some((d) => d.id === delegation.id);
        return exists
          ? prev.map((d) => (d.id === delegation.id ? delegation : d))
          : [delegation, ...prev];
      });
      appendAudit(
        'Updated Staff Delegation',
        `Delegated ${delegation.assignedListingIds.length} listings to ${delegation.staffName}`,
        delegation.id,
        delegation.staffName
      );
    },
    [appendAudit]
  );

  const revokeStaffDelegation = useCallback(
    (delegationId: string) => {
      setStaffDelegations((prev) =>
        prev.map((d) => (d.id === delegationId ? { ...d, status: 'revoked' } : d))
      );
      appendAudit('Revoked Staff Access', `Revoked delegation ${delegationId}`, delegationId);
    },
    [appendAudit]
  );

  const decideVerificationRequest = useCallback(
    (
      requestId: string,
      status: VerificationRequest['status'],
      reason: string
    ) => {
      if (!canAdminPerformAction(currentUser, 'manage_verification')) {
        appendAudit(
          'Blocked Unauthorized Action',
          `Role "${currentUser.adminRole || currentUser.roleType}" attempted verification decision on ${requestId}.`,
          requestId
        );
        return;
      }
      const req = verificationRequests.find((r) => r.id === requestId);
      setVerificationRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                status,
                decisionReason: reason,
                decidedBy: currentUser.name,
                decidedAt: new Date().toISOString(),
              }
            : r
        )
      );
      if (req) {
        setListings((prev) =>
          prev.map((l) =>
            l.id === req.listingId
              ? {
                  ...l,
                  verificationStatus:
                    status === 'approved'
                      ? 'verified_demo'
                      : status === 'more_info_requested'
                        ? 'info_requested'
                        : 'unverified_sample',
                  status: status === 'approved' ? 'published' : l.status,
                }
              : l
          )
        );
      }
      appendAudit(
        'Verification Decision',
        `Marked verification ${requestId} as ${status}: ${reason}`,
        requestId,
        req?.listingTitle
      );
    },
    [verificationRequests, currentUser, appendAudit]
  );

  const decideModerationCase = useCallback(
    (caseId: string, status: ModerationCase['status'], note: string) => {
      if (!canAdminPerformAction(currentUser, 'manage_moderation')) {
        appendAudit(
          'Blocked Unauthorized Action',
          `Role "${currentUser.adminRole || currentUser.roleType}" attempted moderation decision on ${caseId}.`,
          caseId
        );
        return;
      }
      const targetCase = moderationCases.find((c) => c.id === caseId);
      setModerationCases((prev) =>
        prev.map((c) =>
          c.id === caseId
            ? {
                ...c,
                status,
                decisionNote: note,
                decidedBy: currentUser.name,
                decidedAt: new Date().toISOString(),
              }
            : c
        )
      );
      if (targetCase?.targetType === 'review') {
        setReviews((prev) =>
          prev.map((r) =>
            r.id === targetCase.targetId
              ? {
                  ...r,
                  moderationStatus:
                    status === 'resolved_actioned' ? 'hidden' : 'approved',
                }
              : r
          )
        );
      }
      appendAudit(
        'Moderation Decision',
        `Case ${caseId} resolved with ${status}: ${note}`,
        caseId,
        targetCase?.targetTitle
      );
    },
    [moderationCases, currentUser, appendAudit]
  );

  const saveDynamicField = useCallback(
    (field: DynamicFieldDefinition) => {
      if (!canAdminPerformAction(currentUser, 'manage_schema')) {
        appendAudit(
          'Blocked Unauthorized Action',
          `Role "${currentUser.adminRole || currentUser.roleType}" attempted to save dynamic field "${field.label}".`,
          field.id
        );
        return;
      }
      setDynamicFields((prev) => {
        const exists = prev.some((f) => f.id === field.id);
        return exists
          ? prev.map((f) => (f.id === field.id ? field : f))
          : [...prev, field];
      });
      appendAudit('Configured Dynamic Category Field', `Saved field "${field.label}"`, field.id);
    },
    [currentUser, appendAudit]
  );

  const deleteDynamicField = useCallback(
    (fieldId: string) => {
      if (!canAdminPerformAction(currentUser, 'manage_schema')) {
        appendAudit(
          'Blocked Unauthorized Action',
          `Role "${currentUser.adminRole || currentUser.roleType}" attempted to delete dynamic field ${fieldId}.`,
          fieldId
        );
        return;
      }
      setDynamicFields((prev) => prev.filter((f) => f.id !== fieldId));
      appendAudit('Removed Dynamic Field', `Deleted field ${fieldId}`, fieldId);
    },
    [currentUser, appendAudit]
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    void markNotificationAsRead(id);
  }, []);

  const updatePlatformSettings = useCallback(
    (updates: Partial<PlatformSettings>) => {
      if (!canAdminPerformAction(currentUser, 'manage_settings')) {
        appendAudit(
          'Blocked Unauthorized Action',
          `Role "${currentUser.adminRole || currentUser.roleType}" attempted to modify platform settings.`
        );
        return;
      }
      setPlatformSettings((prev) => ({ ...prev, ...updates }));
      appendAudit('Updated Platform Settings', JSON.stringify(updates));
    },
    [currentUser, appendAudit]
  );

  const resetDemoData = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY_STATE);
      localStorage.removeItem(STORAGE_KEY_DRAWN_SHAPES);
      localStorage.removeItem(STORAGE_KEY_SPLIT_PCT);
      localStorage.removeItem(STORAGE_KEY_CUSTOM_DEFAULT_CENTER);
      localStorage.removeItem(STORAGE_KEY_SIMPLE_MODE);
      localStorage.removeItem(STORAGE_KEY_REAL_ESTATE_MODE);
    } catch {
      // ignore
    }
    setSimpleModeStore(false);
    setRealEstateModeStore(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('printswift:reset-demo-data'));
    }
    setCustomDefaultCenterState(null);
    setCurrentMapCenter(CHURACHANDPUR_SAMPLE_CENTER);
    setUsers([]);
    setCurrentUserId('visitor-guest');
    setListings([]);
    setSavedListingIds([]);
    setEnquiries([]);
    setReviews([]);
    setStaffDelegations([]);
    setVerificationRequests([]);
    setModerationCases([]);
    setDynamicFields([]);
    setDrawingState({ present: [], past: [], future: [] });
    setNotifications([]);
    setAuditLogs([]);
    setPlatformSettings(DEFAULT_PLATFORM_SETTINGS);
    setAreaUnit(DEFAULT_AREA_UNIT);
    void retryFetchListings();
  }, [retryFetchListings]);

  const setDrawnShapes: React.Dispatch<React.SetStateAction<DrawnShape[]>> = useCallback(
    (action) => {
      setDrawingState((state) => {
        const next = typeof action === 'function' ? action(state.present) : action;
        if (next === state.present) return state;
        return {
          present: next,
          past: [...state.past.slice(-29), state.present],
          future: [],
        };
      });
    },
    []
  );

  const undoDrawnShapes = useCallback(() => {
    setDrawingState((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        present: previous,
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future.slice(0, 29)],
      };
    });
  }, []);

  const redoDrawnShapes = useCallback(() => {
    setDrawingState((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        present: next,
        past: [...state.past.slice(-29), state.present],
        future: state.future.slice(1),
      };
    });
  }, []);

  const canUndoDrawing = drawingState.past.length > 0;
  const canRedoDrawing = drawingState.future.length > 0;

  const value = useMemo<AppContextValue>(
    () => ({
      currentUser,
      switchUser,
      users,
      updateUserRoleOrStatus,
      appearanceMode,
      setAppearanceMode,
      themePreset,
      setThemePreset,
      resetThemeToDefault,
      mapStyle,
      setMapStyle,
      mapAppearance,
      setMapAppearance,
      configuredMapId,
      configuredLightMapId,
      configuredDarkMapId,
      setConfiguredMapIds,
      mapCloudFallbackNotice,
      useVectorStylePreview,
      setUseVectorStylePreview,
      areaUnit,
      setAreaUnit,
      listings,
      isLoading,
      isFetching,
      setIsFetching,
      isMoving,
      setIsMoving,
      error,
      retryFetchListings,
      savedListingIds,
      toggleSavedListing,
      recordListingInteraction,
      saveListing,
      duplicateListing,
      changeListingStatus,
      restoreListingVersion,
      updateListingCoordinates,
      bulkUpdateListingStatus,
      importListingsBatch,
      saveCatalogueProduct,
      deleteCatalogueProduct,
      enquiries,
      submitVisitorEnquiry,
      replyToEnquiry,
      reviews,
      submitVisitorReview,
      replyToReview,
      reportReview,
      staffDelegations,
      saveStaffDelegation,
      revokeStaffDelegation,
      hasStaffPermission,
      verificationRequests,
      decideVerificationRequest,
      moderationCases,
      decideModerationCase,
      dynamicFields,
      saveDynamicField,
      deleteDynamicField,
      drawnShapes,
      setDrawnShapes,
      undoDrawnShapes,
      redoDrawnShapes,
      canUndoDrawing,
      canRedoDrawing,
      notifications,
      markNotificationRead,
      auditLogs,
      platformSettings,
      updatePlatformSettings,
      resetDemoData,
      mapsQuotaExceeded,
      customDefaultCenter,
      customDefaultZoom,
      effectiveDefaultCenter,
      setCustomDefaultCenter,
      resetCustomDefaultCenter,
      currentMapCenter,
      setCurrentMapCenter,
    }),
    [
      currentUser,
      switchUser,
      users,
      updateUserRoleOrStatus,
      appearanceMode,
      setAppearanceMode,
      themePreset,
      setThemePreset,
      resetThemeToDefault,
      mapStyle,
      setMapStyle,
      mapAppearance,
      setMapAppearance,
      configuredMapId,
      configuredLightMapId,
      configuredDarkMapId,
      setConfiguredMapIds,
      mapCloudFallbackNotice,
      useVectorStylePreview,
      areaUnit,
      listings,
      isLoading,
      isFetching,
      isMoving,
      error,
      retryFetchListings,
      savedListingIds,
      toggleSavedListing,
      recordListingInteraction,
      saveListing,
      duplicateListing,
      changeListingStatus,
      restoreListingVersion,
      updateListingCoordinates,
      bulkUpdateListingStatus,
      importListingsBatch,
      saveCatalogueProduct,
      deleteCatalogueProduct,
      enquiries,
      submitVisitorEnquiry,
      replyToEnquiry,
      reviews,
      submitVisitorReview,
      replyToReview,
      reportReview,
      staffDelegations,
      saveStaffDelegation,
      revokeStaffDelegation,
      hasStaffPermission,
      verificationRequests,
      decideVerificationRequest,
      moderationCases,
      decideModerationCase,
      dynamicFields,
      saveDynamicField,
      deleteDynamicField,
      drawnShapes,
      setDrawnShapes,
      undoDrawnShapes,
      redoDrawnShapes,
      canUndoDrawing,
      canRedoDrawing,
      notifications,
      markNotificationRead,
      auditLogs,
      platformSettings,
      updatePlatformSettings,
      resetDemoData,
      mapsQuotaExceeded,
      customDefaultCenter,
      customDefaultZoom,
      effectiveDefaultCenter,
      setCustomDefaultCenter,
      resetCustomDefaultCenter,
      currentMapCenter,
      setCurrentMapCenter,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const existing = useContext(AppContext);
  if (existing) {
    return <>{children}</>;
  }
  return <AppProviderInner>{children}</AppProviderInner>;
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppStore must be used within AppProvider');
  }
  return ctx;
}

// Step 4F-C: Simple Mode External Store (key: printswift_local_simple_mode_v1, default: false)
const simpleModeListeners = new Set<() => void>();
let cachedSimpleMode = false;
let hasHydratedSimpleMode = false;

function readSimpleModeFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SIMPLE_MODE);
    if (raw === 'true') return true;
    if (raw === 'false' || raw === null) return false;
    return Boolean(JSON.parse(raw));
  } catch {
    return false;
  }
}

function getSimpleModeSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasHydratedSimpleMode) {
    hasHydratedSimpleMode = true;
    cachedSimpleMode = readSimpleModeFromStorage();
  }
  return cachedSimpleMode;
}

function getSimpleModeServerSnapshot(): boolean {
  return false;
}

function subscribeSimpleMode(callback: () => void): () => void {
  if (typeof window !== 'undefined' && !hasHydratedSimpleMode) {
    hasHydratedSimpleMode = true;
    cachedSimpleMode = readSimpleModeFromStorage();
  }
  simpleModeListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_SIMPLE_MODE || ev.key === null) {
      const nextVal = readSimpleModeFromStorage();
      if (cachedSimpleMode !== nextVal) {
        cachedSimpleMode = nextVal;
        callback();
      }
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  return () => {
    simpleModeListeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

export function setSimpleModeStore(
  next: boolean | ((prev: boolean) => boolean)
): void {
  const prev = getSimpleModeSnapshot();
  const resolved = typeof next === 'function' ? next(prev) : Boolean(next);
  cachedSimpleMode = resolved;
  hasHydratedSimpleMode = true;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY_SIMPLE_MODE, String(resolved));
    } catch {
      // ignore quota errors
    }
  }
  simpleModeListeners.forEach((listener) => listener());
}

export type SimpleModeHookResult = [
  boolean,
  (next: boolean | ((prev: boolean) => boolean)) => void,
] & {
  simpleMode: boolean;
  isSimpleMode: boolean;
  setSimpleMode: (next: boolean | ((prev: boolean) => boolean)) => void;
  toggleSimpleMode: () => void;
};

export function useSimpleMode(): SimpleModeHookResult {
  const simpleMode = useSyncExternalStore(
    subscribeSimpleMode,
    getSimpleModeSnapshot,
    getSimpleModeServerSnapshot
  );

  const toggleSimpleMode = useCallback(() => {
    setSimpleModeStore((prev) => !prev);
  }, []);

  return useMemo(() => {
    const tuple = [simpleMode, setSimpleModeStore] as unknown as SimpleModeHookResult;
    tuple.simpleMode = simpleMode;
    tuple.isSimpleMode = simpleMode;
    tuple.setSimpleMode = setSimpleModeStore;
    tuple.toggleSimpleMode = toggleSimpleMode;
    return tuple;
  }, [simpleMode, toggleSimpleMode]);
}

// Step 4F-D1: Real Estate Mode External Store (key: printswift_local_real_estate_mode_v1, default: false)
const realEstateModeListeners = new Set<() => void>();
let cachedRealEstateMode = false;
let hasHydratedRealEstateMode = false;

function readRealEstateModeFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_REAL_ESTATE_MODE);
    if (raw === 'true') return true;
    if (raw === 'false' || raw === null) return false;
    return Boolean(JSON.parse(raw));
  } catch {
    return false;
  }
}

function getRealEstateModeSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasHydratedRealEstateMode) {
    hasHydratedRealEstateMode = true;
    cachedRealEstateMode = readRealEstateModeFromStorage();
  }
  return cachedRealEstateMode;
}

function getRealEstateModeServerSnapshot(): boolean {
  return false;
}

function subscribeRealEstateMode(callback: () => void): () => void {
  if (typeof window !== 'undefined' && !hasHydratedRealEstateMode) {
    hasHydratedRealEstateMode = true;
    cachedRealEstateMode = readRealEstateModeFromStorage();
  }
  realEstateModeListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_REAL_ESTATE_MODE || ev.key === null) {
      const nextVal = readRealEstateModeFromStorage();
      if (cachedRealEstateMode !== nextVal) {
        cachedRealEstateMode = nextVal;
        callback();
      }
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  return () => {
    realEstateModeListeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

export function setRealEstateModeStore(
  next: boolean | ((prev: boolean) => boolean)
): void {
  const prev = getRealEstateModeSnapshot();
  const resolved = typeof next === 'function' ? next(prev) : Boolean(next);
  cachedRealEstateMode = resolved;
  hasHydratedRealEstateMode = true;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY_REAL_ESTATE_MODE, String(resolved));
    } catch {
      // ignore quota errors
    }
  }
  realEstateModeListeners.forEach((listener) => listener());
}

export type RealEstateModeHookResult = [
  boolean,
  (next: boolean | ((prev: boolean) => boolean)) => void,
] & {
  realEstateMode: boolean;
  isRealEstateMode: boolean;
  setRealEstateMode: (next: boolean | ((prev: boolean) => boolean)) => void;
  toggleRealEstateMode: () => void;
};

export function useRealEstateMode(): RealEstateModeHookResult {
  const isRealEstateMode = useSyncExternalStore(
    subscribeRealEstateMode,
    getRealEstateModeSnapshot,
    getRealEstateModeServerSnapshot
  );

  const toggleRealEstateMode = useCallback(() => {
    setRealEstateModeStore((prev) => !prev);
  }, []);

  return useMemo(() => {
    const tuple = [
      isRealEstateMode,
      setRealEstateModeStore,
    ] as unknown as RealEstateModeHookResult;
    tuple.realEstateMode = isRealEstateMode;
    tuple.isRealEstateMode = isRealEstateMode;
    tuple.setRealEstateMode = setRealEstateModeStore;
    tuple.toggleRealEstateMode = toggleRealEstateMode;
    return tuple;
  }, [isRealEstateMode, toggleRealEstateMode]);
}

// Pass V6-B: 4-Preset Explore Map Experience External Store (supersedes separate Simple/Estate toggles)
const exploreMapPresetListeners = new Set<() => void>();
let cachedExploreMapPreset: ExploreMapPresetId = 'everyday';
let hasHydratedExploreMapPreset = false;

function isExploreMapPresetId(val: unknown): val is ExploreMapPresetId {
  return (
    val === 'everyday' ||
    val === 'clean_focus' ||
    val === 'property_hunter' ||
    val === 'pro_survey'
  );
}

function readExploreMapPresetFromStorage(): ExploreMapPresetId {
  if (typeof window === 'undefined') return 'everyday';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_EXPLORE_MAP_PRESET);
    if (isExploreMapPresetId(raw)) return raw;
    // Migrate gracefully from legacy Simple Mode / Real Estate Mode flags
    const legacyRealEstate = readRealEstateModeFromStorage();
    if (legacyRealEstate) return 'property_hunter';
    const legacySimple = readSimpleModeFromStorage();
    if (legacySimple) return 'clean_focus';
  } catch {
    // ignore storage errors
  }
  return 'everyday';
}

function getExploreMapPresetSnapshot(): ExploreMapPresetId {
  if (typeof window === 'undefined') return 'everyday';
  if (!hasHydratedExploreMapPreset) {
    hasHydratedExploreMapPreset = true;
    cachedExploreMapPreset = readExploreMapPresetFromStorage();
  }
  return cachedExploreMapPreset;
}

function getExploreMapPresetServerSnapshot(): ExploreMapPresetId {
  return 'everyday';
}

function subscribeExploreMapPreset(callback: () => void): () => void {
  if (typeof window !== 'undefined' && !hasHydratedExploreMapPreset) {
    hasHydratedExploreMapPreset = true;
    cachedExploreMapPreset = readExploreMapPresetFromStorage();
  }
  exploreMapPresetListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (
      ev.key === STORAGE_KEY_EXPLORE_MAP_PRESET ||
      ev.key === STORAGE_KEY_SIMPLE_MODE ||
      ev.key === STORAGE_KEY_REAL_ESTATE_MODE ||
      ev.key === null
    ) {
      const nextVal = readExploreMapPresetFromStorage();
      if (cachedExploreMapPreset !== nextVal) {
        cachedExploreMapPreset = nextVal;
        callback();
      }
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  return () => {
    exploreMapPresetListeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

export function setExploreMapPresetStore(next: ExploreMapPresetId): void {
  const resolved: ExploreMapPresetId = isExploreMapPresetId(next)
    ? next
    : 'everyday';
  cachedExploreMapPreset = resolved;
  hasHydratedExploreMapPreset = true;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY_EXPLORE_MAP_PRESET, resolved);
    } catch {
      // ignore quota errors
    }
  }
  const meta =
    EXPLORE_MAP_PRESETS.find((p) => p.id === resolved) ||
    EXPLORE_MAP_PRESETS[0];
  setSimpleModeStore(meta.simpleMode);
  setRealEstateModeStore(meta.realEstateMode);
  exploreMapPresetListeners.forEach((listener) => listener());
}

export type ExploreMapPresetHookResult = [
  ExploreMapPresetId,
  (next: ExploreMapPresetId) => void,
] & {
  preset: ExploreMapPresetId;
  meta: ExploreMapPresetMeta;
  setPreset: (next: ExploreMapPresetId) => void;
};

export function useExploreMapPreset(): ExploreMapPresetHookResult {
  const preset = useSyncExternalStore(
    subscribeExploreMapPreset,
    getExploreMapPresetSnapshot,
    getExploreMapPresetServerSnapshot
  );

  return useMemo(() => {
    const meta =
      EXPLORE_MAP_PRESETS.find((p) => p.id === preset) ||
      EXPLORE_MAP_PRESETS[0];
    const tuple = [
      preset,
      setExploreMapPresetStore,
    ] as unknown as ExploreMapPresetHookResult;
    tuple.preset = preset;
    tuple.meta = meta;
    tuple.setPreset = setExploreMapPresetStore;
    return tuple;
  }, [preset]);
}

// Phase 56-A & 56-B: Global Map Status Store for Navbar Logo Status Merge
export type GlobalMapStatusMode = 'idle' | 'loading' | 'searching' | 'visible_area';

export interface GlobalMapStatusSnapshot {
  status: GlobalMapStatusMode;
  isPanning: boolean;
  isLoading: boolean;
  visibleCount: number;
}

const INITIAL_MAP_STATUS_SNAPSHOT: GlobalMapStatusSnapshot = Object.freeze({
  status: 'idle',
  isPanning: false,
  isLoading: false,
  visibleCount: 76,
});

const mapStatusListeners = new Set<() => void>();
let cachedMapStatusSnapshot: GlobalMapStatusSnapshot = INITIAL_MAP_STATUS_SNAPSHOT;

function getMapStatusSnapshot(): GlobalMapStatusSnapshot {
  return cachedMapStatusSnapshot;
}

function getMapStatusServerSnapshot(): GlobalMapStatusSnapshot {
  return INITIAL_MAP_STATUS_SNAPSHOT;
}

function subscribeMapStatus(callback: () => void): () => void {
  mapStatusListeners.add(callback);
  return () => {
    mapStatusListeners.delete(callback);
  };
}

export function setMapStatusStore(
  updates: Partial<GlobalMapStatusSnapshot>
): void {
  const nextIsPanning = updates.isPanning ?? cachedMapStatusSnapshot.isPanning;
  const nextIsLoading = updates.isLoading ?? cachedMapStatusSnapshot.isLoading;
  const nextVisibleCount =
    updates.visibleCount ?? cachedMapStatusSnapshot.visibleCount;
  const nextStatus: GlobalMapStatusMode =
    updates.status ??
    (nextIsPanning || nextIsLoading ? 'loading' : 'idle');

  const next: GlobalMapStatusSnapshot = {
    status: nextStatus,
    isPanning: nextIsPanning,
    isLoading: nextIsLoading,
    visibleCount: nextVisibleCount,
  };
  if (
    next.status === cachedMapStatusSnapshot.status &&
    next.isPanning === cachedMapStatusSnapshot.isPanning &&
    next.isLoading === cachedMapStatusSnapshot.isLoading &&
    next.visibleCount === cachedMapStatusSnapshot.visibleCount
  ) {
    return;
  }
  cachedMapStatusSnapshot = next;
  mapStatusListeners.forEach((listener) => listener());
}

export function useMapStatusStore(): GlobalMapStatusSnapshot {
  return useSyncExternalStore(
    subscribeMapStatus,
    getMapStatusSnapshot,
    getMapStatusServerSnapshot
  );
}

export {
  APP_STATUS_LABELS,
  clearAppStatus,
  setAppStatus,
  useAppStatus,
  type AppStatusSnapshot,
  type AppStatusType,
  type UseAppStatusResult,
} from './hooks/useAppStatus';

export {
  ADMIN_AUTHORIZED_ROLES,
  STORAGE_KEY_AUTH_SESSION,
  WORKSPACE_AUTHORIZED_ROLES,
  canRoleAccessAdmin,
  canRoleAccessWorkspace,
  getEffectiveRoleWithOverride,
  getPreviewHubSlugCookie,
  getViewAsRoleCookie,
  setAuthStoreState,
  setServerViewAsRoleOverride,
  syncAuthenticatedProfileRole,
  useAuth,
  type AuthState,
  type SynchronizedRole,
  type UseAuthResult,
} from './auth';



