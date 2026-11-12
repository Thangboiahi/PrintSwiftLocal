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
import {
  CHURACHANDPUR_SAMPLE_CENTER,
  INITIAL_AUDIT_LOGS,
  INITIAL_DYNAMIC_FIELDS,
  INITIAL_ENQUIRIES,
  INITIAL_MODERATION_CASES,
  INITIAL_NOTIFICATIONS,
  INITIAL_REVIEWS,
  INITIAL_STAFF_DELEGATIONS,
  INITIAL_USERS,
  INITIAL_VERIFICATION_REQUESTS,
  createInitialListings,
} from './seed-data';
import {
  DEFAULT_AREA_UNIT,
  canAdminPerformAction,
  hasValidMandatoryPanorama,
  sanitizeRealEstateForPropertyType,
} from './rules';
import { sanitizeMapId } from './map-cloud-styles';
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

interface PlatformSettings {
  maintenanceNotice: string;
  requirePanoramaForRealEstate: boolean;
  defaultAreaUnit: AreaUnit;
  dataRetentionDays: number;
  enablePublicEnquiries: boolean;
  enablePublicReviews: boolean;
  sponsoredSlotsEnabledDemo: boolean;
}

interface AppContextValue {
  // Configurable Default Map Centre (Step 4F-B)
  customDefaultCenter: LatLngPoint | null;
  effectiveDefaultCenter: LatLngPoint;
  setCustomDefaultCenter: (coords: LatLngPoint) => void;
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

  // Coherent Data Records
  listings: Listing[];
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<UserAccount[]>(INITIAL_USERS);
  const [currentUserId, setCurrentUserId] = useState<string>('visitor-demo');

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

  // Step 4F-B: Configurable Default Map Centre
  const [customDefaultCenter, setCustomDefaultCenterState] =
    useState<LatLngPoint | null>(null);
  const [currentMapCenter, setCurrentMapCenter] = useState<LatLngPoint>(
    CHURACHANDPUR_SAMPLE_CENTER
  );
  const effectiveDefaultCenter = useMemo(
    () => customDefaultCenter || CHURACHANDPUR_SAMPLE_CENTER,
    [customDefaultCenter]
  );
  const setCustomDefaultCenter = useCallback((coords: LatLngPoint) => {
    const sanitized: LatLngPoint = {
      lat: Number(coords.lat.toFixed(6)),
      lng: Number(coords.lng.toFixed(6)),
    };
    setCustomDefaultCenterState(sanitized);
    try {
      localStorage.setItem(
        STORAGE_KEY_CUSTOM_DEFAULT_CENTER,
        JSON.stringify(sanitized)
      );
    } catch {
      // ignore quota errors
    }
  }, []);
  const resetCustomDefaultCenter = useCallback(() => {
    setCustomDefaultCenterState(null);
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_DEFAULT_CENTER);
    } catch {
      // ignore
    }
  }, []);

  const [listings, setListings] = useState<Listing[]>(() => createInitialListings());
  const [savedListingIds, setSavedListingIds] = useState<string[]>(['biz-1', 're-1', 'spt-1']);
  const [enquiries, setEnquiries] = useState<EnquiryRecord[]>(INITIAL_ENQUIRIES);
  const [reviews, setReviews] = useState<ReviewRecord[]>(INITIAL_REVIEWS);
  const [staffDelegations, setStaffDelegations] = useState<StaffDelegation[]>(
    INITIAL_STAFF_DELEGATIONS
  );
  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>(
    INITIAL_VERIFICATION_REQUESTS
  );
  const [moderationCases, setModerationCases] = useState<ModerationCase[]>(
    INITIAL_MODERATION_CASES
  );
  const [dynamicFields, setDynamicFields] = useState<DynamicFieldDefinition[]>(
    INITIAL_DYNAMIC_FIELDS
  );
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
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    INITIAL_NOTIFICATIONS
  );
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
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
      const msg = args.map((a) => String(a)).join(' ');
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
              'Google Cloud Billing is not yet enabled on the active API key project (BillingNotEnabledMapError). Switched to PrintSwift Cloud-Style Vector Preview fallback until Cloud Billing is active.',
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
          if (Array.isArray(parsed.listings) && parsed.listings.length > 0) {
            setListings(parsed.listings);
          }
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
          if (Array.isArray(parsed.notifications)) setNotifications(parsed.notifications);
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
          }
        }
      } catch {
        // Ignore storage parse error and keep seed state
      } finally {
        setHydrated(true);
      }
    });
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

  const currentUser = useMemo(
    () => users.find((u) => u.id === currentUserId) || users[0],
    [users, currentUserId]
  );

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

  const toggleSavedListing = useCallback((listingId: string) => {
    setSavedListingIds((prev) => {
      const exists = prev.includes(listingId);
      const next = exists
        ? prev.filter((id) => id !== listingId)
        : [...prev, listingId];
      setListings((curr) =>
        curr.map((l) =>
          l.id === listingId
            ? { ...l, followsCount: Math.max(0, l.followsCount + (exists ? -1 : 1)) }
            : l
        )
      );
      return next;
    });
  }, []);

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

      // Enforce mandatory real-estate 360° panorama rule on submission/publication
      if (
        cleaned.category === 'real_estate' &&
        desiredStatus !== 'draft' &&
        desiredStatus !== 'archived' &&
        !hasValidMandatoryPanorama(cleaned)
      ) {
        return {
          ok: false,
          message:
            'Submission blocked: A valid 360° equirectangular panorama is compulsory for every real-estate listing before submission or publication. You may save this listing as a Draft.',
        };
      }

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
    setUsers(INITIAL_USERS);
    setCurrentUserId('visitor-demo');
    setListings(createInitialListings());
    setSavedListingIds(['biz-1', 're-1', 'spt-1']);
    setEnquiries(INITIAL_ENQUIRIES);
    setReviews(INITIAL_REVIEWS);
    setStaffDelegations(INITIAL_STAFF_DELEGATIONS);
    setVerificationRequests(INITIAL_VERIFICATION_REQUESTS);
    setModerationCases(INITIAL_MODERATION_CASES);
    setDynamicFields(INITIAL_DYNAMIC_FIELDS);
    setDrawingState({ present: [], past: [], future: [] });
    setNotifications(INITIAL_NOTIFICATIONS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setPlatformSettings(DEFAULT_PLATFORM_SETTINGS);
    setAreaUnit(DEFAULT_AREA_UNIT);
  }, []);

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
      effectiveDefaultCenter,
      setCustomDefaultCenter,
      resetCustomDefaultCenter,
      currentMapCenter,
      setCurrentMapCenter,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
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

function getSimpleModeSnapshot(): boolean {
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

function getSimpleModeServerSnapshot(): boolean {
  return false;
}

function subscribeSimpleMode(callback: () => void): () => void {
  simpleModeListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_SIMPLE_MODE || ev.key === null) {
      callback();
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

function getRealEstateModeSnapshot(): boolean {
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

function getRealEstateModeServerSnapshot(): boolean {
  return false;
}

function subscribeRealEstateMode(callback: () => void): () => void {
  realEstateModeListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_REAL_ESTATE_MODE || ev.key === null) {
      callback();
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


