'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildNestedCategoryTrees,
  collectCategorySubtree,
  type AppAnnouncementRecord,
  type AppBannerRecord,
  type AppCategoryRecord,
  type AppConfig,
  type AppIdentityConfig,
  type AppLocalityRecord,
  type CategoriesByEntityMap,
  type CategoryEntityType,
  DEFAULT_APP_IDENTITY,
  DEFAULT_LEGAL_PAGES,
  DEFAULT_OFFICE_AND_CONTACT,
  DEFAULT_ONBOARDING_AND_REFERRALS,
  DEFAULT_OPERATIONS_CONFIG,
  DEFAULT_PAYMENT_CONFIG,
  DEFAULT_PRICING_SURCHARGES,
  DEFAULT_SERVICE_HUB,
  EMPTY_CATEGORIES_BY_ENTITY,
  type HelpbotFaqRecord,
  type HubLocalityItem,
  type HubVehicleRateItem,
  type LegalPagesConfig,
  type NestedCategoryNode,
  normalizeAppIdentity,
  normalizeLegalPages,
  normalizeOfficeAndContact,
  normalizeOnboardingAndReferrals,
  normalizeOperationsConfig,
  normalizePaymentConfig,
  normalizePricingSurcharges,
  type OfficeAndContactConfig,
  type OnboardingAndReferralsConfig,
  type OperationsConfig,
  type PaymentConfig,
  type PricingSurchargesConfig,
  type ServiceHubRecord,
} from '@/lib/config/types';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';

const CONFIG_CACHE_PREFIX = 'psl_config_cache_';
const LEGACY_CONFIG_CACHE_KEY = 'printswift_public_app_config_v1';
export const PSL_ACTIVE_HUB_SLUG_KEY = 'psl_active_hub_slug';
export const LEGACY_ACTIVE_HUB_SLUG_KEY = 'printswift_active_hub_slug_v1';
export const PSL_HUB_SELECTED_KEY = 'psl_hub_selected';
export const APP_CONFIG_UPDATED_EVENT = 'printswift:app-config-updated';
export const HUB_SWITCHED_EVENT = 'printswift:hub-switched';

export interface DetectResult {
  matched_hub: ServiceHubRecord | null;
  nearest_hub: ServiceHubRecord | null;
  distance_km: number | null;
  is_within_service_area: boolean;
  lat?: number;
  lng?: number;
  error?: string;
}

const FALLBACK_CONFIG: AppConfig = {
  hubs: [DEFAULT_SERVICE_HUB],
  activeHub: DEFAULT_SERVICE_HUB,
  hubVehicleRates: [],
  app_identity: DEFAULT_APP_IDENTITY,
  office_and_contact: DEFAULT_OFFICE_AND_CONTACT,
  payment_config: DEFAULT_PAYMENT_CONFIG,
  operations_config: DEFAULT_OPERATIONS_CONFIG,
  pricing_surcharges: DEFAULT_PRICING_SURCHARGES,
  legal_pages: DEFAULT_LEGAL_PAGES,
  onboarding_and_referrals: DEFAULT_ONBOARDING_AND_REFERRALS,
  categories: [],
  categoriesFlat: [],
  categoriesByEntity: { ...EMPTY_CATEGORIES_BY_ENTITY },
  localities: [],
  hubLocalities: [],
  helpbot_faqs: [],
  announcements: [],
  banners: [],
  fetched_at: DEFAULT_LEGAL_PAGES.updated_at,
};

function getConfigCacheKey(slug: string): string {
  const cleanSlug = (slug || DEFAULT_SERVICE_HUB.slug).trim().toLowerCase();
  return `${CONFIG_CACHE_PREFIX}${cleanSlug || DEFAULT_SERVICE_HUB.slug}`;
}

function readStoredHubSlug(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      window.localStorage.getItem(PSL_ACTIVE_HUB_SLUG_KEY)?.trim() ||
      window.localStorage.getItem(LEGACY_ACTIVE_HUB_SLUG_KEY)?.trim() ||
      ''
    ).toLowerCase();
  } catch {
    return '';
  }
}

function persistActiveHubSlug(slug: string, markExplicit = true): void {
  if (typeof window === 'undefined') return;
  const clean = slug.trim().toLowerCase();
  if (!clean) return;
  try {
    window.localStorage.setItem(PSL_ACTIVE_HUB_SLUG_KEY, clean);
    window.localStorage.setItem(LEGACY_ACTIVE_HUB_SLUG_KEY, clean);
    if (markExplicit) {
      window.localStorage.setItem(PSL_HUB_SELECTED_KEY, '1');
    }
  } catch {
    // Ignore storage quota / private mode failures
  }
}

function readUrlHubParam(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get('hub') || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function sanitizeConfigPayload(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') return FALLBACK_CONFIG;
  const obj = raw as Record<string, unknown>;
  const hubs =
    Array.isArray(obj.hubs) && obj.hubs.length > 0
      ? (obj.hubs as ServiceHubRecord[])
      : [DEFAULT_SERVICE_HUB];
  const activeHub =
    obj.activeHub && typeof obj.activeHub === 'object'
      ? (obj.activeHub as ServiceHubRecord)
      : hubs[0] || DEFAULT_SERVICE_HUB;

  const categoriesFlat = Array.isArray(obj.categoriesFlat)
    ? (obj.categoriesFlat as NestedCategoryNode[])
    : [];

  const rawByEntity =
    obj.categoriesByEntity && typeof obj.categoriesByEntity === 'object'
      ? (obj.categoriesByEntity as Partial<CategoriesByEntityMap>)
      : null;

  const categoriesByEntity: CategoriesByEntityMap =
    rawByEntity &&
    Array.isArray(rawByEntity.listing) &&
    Array.isArray(rawByEntity.product) &&
    Array.isArray(rawByEntity.bulletin) &&
    Array.isArray(rawByEntity.vehicle)
      ? {
          listing: rawByEntity.listing,
          product: rawByEntity.product,
          bulletin: rawByEntity.bulletin,
          vehicle: rawByEntity.vehicle,
        }
      : buildNestedCategoryTrees(categoriesFlat);

  return {
    hubs,
    activeHub,
    hubVehicleRates: Array.isArray(obj.hubVehicleRates)
      ? (obj.hubVehicleRates as HubVehicleRateItem[])
      : [],
    app_identity: normalizeAppIdentity(obj.identity ?? obj.app_identity),
    office_and_contact: normalizeOfficeAndContact(
      obj.office ?? obj.office_and_contact
    ),
    payment_config: normalizePaymentConfig(
      obj.paymentConfig ?? obj.payment_config
    ),
    operations_config: normalizeOperationsConfig(
      obj.operations ?? obj.operations_config
    ),
    pricing_surcharges: normalizePricingSurcharges(
      obj.surcharges ?? obj.pricing_surcharges
    ),
    legal_pages: normalizeLegalPages(obj.legal ?? obj.legal_pages),
    onboarding_and_referrals: normalizeOnboardingAndReferrals(
      obj.onboardingAndReferrals ?? obj.onboarding_and_referrals,
      normalizeOfficeAndContact(obj.office ?? obj.office_and_contact).whatsapp ||
        normalizeOfficeAndContact(obj.office ?? obj.office_and_contact).phone
    ),
    categories: Array.isArray(obj.categories)
      ? (obj.categories as AppCategoryRecord[])
      : [],
    categoriesFlat,
    categoriesByEntity,
    localities: Array.isArray(obj.localities)
      ? (obj.localities as AppLocalityRecord[])
      : [],
    hubLocalities: Array.isArray(obj.hubLocalities)
      ? (obj.hubLocalities as HubLocalityItem[])
      : [],
    helpbot_faqs: Array.isArray(obj.helpbotFaqs ?? obj.helpbot_faqs)
      ? ((obj.helpbotFaqs ?? obj.helpbot_faqs) as HelpbotFaqRecord[])
      : [],
    announcements: Array.isArray(obj.announcements)
      ? (obj.announcements as AppAnnouncementRecord[])
      : [],
    banners: Array.isArray(obj.banners)
      ? (obj.banners as AppBannerRecord[])
      : [],
    fetched_at:
      typeof obj.fetched_at === 'string' && obj.fetched_at
        ? obj.fetched_at
        : new Date().toISOString(),
  };
}

export function notifyAppConfigUpdated(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_CONFIG_CACHE_KEY);
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (
        k &&
        (k.startsWith(CONFIG_CACHE_PREFIX) ||
          k.startsWith('psl_listings_cache_') ||
          k.startsWith('psl_map_state_'))
      ) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage quota / private mode failures
  }
  window.dispatchEvent(new CustomEvent(APP_CONFIG_UPDATED_EVENT));
}

export interface AppConfigContextValue {
  config: AppConfig;
  hubs: ServiceHubRecord[];
  activeHub: ServiceHubRecord;
  hubVehicleRates: HubVehicleRateItem[];
  identity: AppIdentityConfig;
  office: OfficeAndContactConfig;
  paymentConfig: PaymentConfig;
  operations: OperationsConfig;
  surcharges: PricingSurchargesConfig;
  legal: LegalPagesConfig;
  onboardingAndReferrals: OnboardingAndReferralsConfig;
  supportWhatsApp: string;
  categories: AppCategoryRecord[];
  categoriesFlat: NestedCategoryNode[];
  categoriesByEntity: CategoriesByEntityMap;
  localities: AppLocalityRecord[];
  hubLocalities: HubLocalityItem[];
  helpbotFaqs: HelpbotFaqRecord[];
  announcements: AppAnnouncementRecord[];
  banners: AppBannerRecord[];
  isLoading: boolean;
  isSwitchingHub: boolean;
  hasExplicitHubChoice: boolean;
  switchHub: (slug: string) => Promise<void>;
  detectHubByGPS: () => Promise<DetectResult>;
  dismissHubWelcome: () => void;
  getCategorySubtreeSlugsOrIds: (
    categoryId: string | null | undefined,
    entityType?: CategoryEntityType
  ) => { ids: string[]; slugs: string[] };
  refreshConfig: (
    forceFresh?: boolean,
    hubSlugOverride?: string | null
  ) => Promise<AppConfig | null>;
}

const AppConfigContext = createContext<AppConfigContextValue>({
  config: FALLBACK_CONFIG,
  hubs: [DEFAULT_SERVICE_HUB],
  activeHub: DEFAULT_SERVICE_HUB,
  hubVehicleRates: [],
  identity: DEFAULT_APP_IDENTITY,
  office: DEFAULT_OFFICE_AND_CONTACT,
  paymentConfig: DEFAULT_PAYMENT_CONFIG,
  operations: DEFAULT_OPERATIONS_CONFIG,
  surcharges: DEFAULT_PRICING_SURCHARGES,
  legal: DEFAULT_LEGAL_PAGES,
  onboardingAndReferrals: DEFAULT_ONBOARDING_AND_REFERRALS,
  supportWhatsApp: '',
  categories: [],
  categoriesFlat: [],
  categoriesByEntity: { ...EMPTY_CATEGORIES_BY_ENTITY },
  localities: [],
  hubLocalities: [],
  helpbotFaqs: [],
  announcements: [],
  banners: [],
  isLoading: false,
  isSwitchingHub: false,
  hasExplicitHubChoice: true,
  switchHub: async () => {},
  detectHubByGPS: async () => ({
    matched_hub: null,
    nearest_hub: null,
    distance_km: null,
    is_within_service_area: false,
  }),
  dismissHubWelcome: () => {},
  getCategorySubtreeSlugsOrIds: () => ({ ids: [], slugs: [] }),
  refreshConfig: async () => null,
});

export function AppConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { defaultHubId } = useAuth();
  const { setStatus } = useAppStatus();

  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSwitchingHub, setIsSwitchingHub] = useState<boolean>(false);
  // Default to true during SSR to prevent hydration flicker; resolved on client mount
  const [hasExplicitHubChoice, setHasExplicitHubChoice] =
    useState<boolean>(true);
  const appliedProfileDefaultHubRef = useRef<string | null>(null);

  const fetchConfig = useCallback(
    async (
      forceFresh = false,
      options?: {
        hubSlug?: string | null;
        hubId?: string | null;
      }
    ): Promise<AppConfig | null> => {
      try {
        const requestedSlug = (options?.hubSlug || '').trim().toLowerCase();
        const requestedHubId = (options?.hubId || '').trim();

        const params = new URLSearchParams();
        if (requestedSlug) {
          params.set('hub', requestedSlug);
        } else if (requestedHubId) {
          params.set('hubId', requestedHubId);
        } else {
          // Strict priority order:
          // 1. URL query param ?hub=<slug>
          // 2. Signed-in user's profile.default_hub_id
          // 3. localStorage (psl_active_hub_slug)
          // 4. Default active hub (churachandpur)
          const urlSlug = readUrlHubParam();
          const storedSlug = readStoredHubSlug();
          if (urlSlug) {
            params.set('hub', urlSlug);
          } else if (defaultHubId) {
            params.set('hubId', defaultHubId);
          } else if (storedSlug) {
            params.set('hub', storedSlug);
          } else {
            params.set('hub', DEFAULT_SERVICE_HUB.slug);
          }
        }

        if (forceFresh) {
          params.set('fresh', '1');
          params.set('_t', String(Date.now()));
        }

        const qs = params.toString();
        const endpoint = qs ? `/api/config/public?${qs}` : '/api/config/public';

        const res = await fetch(endpoint, {
          cache: forceFresh ? 'no-store' : 'default',
        });
        if (!res.ok) return null;
        const json = await res.json();
        const normalized = sanitizeConfigPayload(json);
        setConfig(normalized);

        if (typeof window !== 'undefined' && normalized.activeHub?.slug) {
          try {
            window.localStorage.setItem(
              getConfigCacheKey(normalized.activeHub.slug),
              JSON.stringify(normalized)
            );
          } catch {
            // Ignore storage quota errors
          }
        }
        return normalized;
      } catch {
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [defaultHubId]
  );

  // Hydrate instantly from hub-keyed SWR localStorage cache on mount, then revalidate from /api/config/public
  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      if (!active || typeof window === 'undefined') return;

      const urlHubSlug = readUrlHubParam();
      const storedHubSlug = readStoredHubSlug();
      const hasExplicitFlag =
        window.localStorage.getItem(PSL_HUB_SELECTED_KEY) === '1' ||
        Boolean(urlHubSlug) ||
        Boolean(defaultHubId) ||
        Boolean(storedHubSlug);

      setHasExplicitHubChoice(hasExplicitFlag);

      // Hydrate from hub-scoped SWR cache (`psl_config_cache_${slug}`) for instant rural-network load
      const candidateCacheSlug =
        urlHubSlug || storedHubSlug || DEFAULT_SERVICE_HUB.slug;
      try {
        const cachedRaw = window.localStorage.getItem(
          getConfigCacheKey(candidateCacheSlug)
        );
        if (cachedRaw) {
          const parsed = sanitizeConfigPayload(JSON.parse(cachedRaw));
          if (parsed.activeHub?.slug?.toLowerCase() === candidateCacheSlug) {
            setConfig(parsed);
          }
        }
      } catch {
        // Ignore corrupt cache entries
      }

      const loaded = await fetchConfig(false, {
        hubSlug: urlHubSlug || undefined,
        hubId: !urlHubSlug && defaultHubId ? defaultHubId : undefined,
      });

      if (!active || !loaded) return;

      // If URL had ?hub=<slug> and it resolved to an active hub, persist choice
      if (
        urlHubSlug &&
        loaded.activeHub.slug.toLowerCase() === urlHubSlug &&
        loaded.activeHub.status === 'active'
      ) {
        persistActiveHubSlug(loaded.activeHub.slug, true);
        setHasExplicitHubChoice(true);
      } else if (
        !urlHubSlug &&
        defaultHubId &&
        loaded.activeHub.id === defaultHubId
      ) {
        appliedProfileDefaultHubRef.current = defaultHubId;
        persistActiveHubSlug(loaded.activeHub.slug, true);
        setHasExplicitHubChoice(true);
      }
    });

    const handleUpdated = () => {
      void fetchConfig(true);
    };

    window.addEventListener(APP_CONFIG_UPDATED_EVENT, handleUpdated);
    return () => {
      active = false;
      window.removeEventListener(APP_CONFIG_UPDATED_EVENT, handleUpdated);
    };
  }, [fetchConfig, defaultHubId]);

  // When a user signs in and has profile.default_hub_id, sync active hub if no ?hub= URL param overrides it
  useEffect(() => {
    if (!defaultHubId || typeof window === 'undefined') return;
    if (appliedProfileDefaultHubRef.current === defaultHubId) return;
    const urlHubSlug = readUrlHubParam();
    if (urlHubSlug) return;

    appliedProfileDefaultHubRef.current = defaultHubId;
    if (config.activeHub.id === defaultHubId) {
      persistActiveHubSlug(config.activeHub.slug, true);
      queueMicrotask(() => {
        setHasExplicitHubChoice(true);
      });
      return;
    }

    const matchedInLoaded = config.hubs.find(
      (h) => h.id === defaultHubId && h.status === 'active'
    );
    if (matchedInLoaded) {
      persistActiveHubSlug(matchedInLoaded.slug, true);
      queueMicrotask(() => {
        setHasExplicitHubChoice(true);
        void fetchConfig(true, { hubSlug: matchedInLoaded.slug });
      });
    } else {
      queueMicrotask(() => {
        void fetchConfig(true, { hubId: defaultHubId });
      });
    }
  }, [defaultHubId, config.activeHub.id, config.activeHub.slug, config.hubs, fetchConfig]);

  const switchHub = useCallback(
    async (slug: string): Promise<void> => {
      const cleanSlug = (slug || '').trim().toLowerCase();
      if (!cleanSlug) return;

      const targetHub = config.hubs.find(
        (h) => h.slug.toLowerCase() === cleanSlug
      );
      if (targetHub && targetHub.status !== 'active') {
        return;
      }

      persistActiveHubSlug(cleanSlug, true);
      setHasExplicitHubChoice(true);
      setIsSwitchingHub(true);
      setStatus('syncing', `Switching to ${targetHub?.name || cleanSlug}`);

      // Hydrate immediately from hub-keyed SWR cache if available (never from another hub's cache)
      if (typeof window !== 'undefined') {
        try {
          const cachedRaw = window.localStorage.getItem(
            getConfigCacheKey(cleanSlug)
          );
          if (cachedRaw) {
            const parsed = sanitizeConfigPayload(JSON.parse(cachedRaw));
            if (parsed.activeHub?.slug?.toLowerCase() === cleanSlug) {
              setConfig(parsed);
            }
          }
        } catch {
          // Ignore cache parse error
        }
      }

      try {
        const updated = await fetchConfig(true, { hubSlug: cleanSlug });
        if (updated) {
          persistActiveHubSlug(updated.activeHub.slug, true);
          setStatus('success', `${updated.activeHub.name} Hub active`);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent(HUB_SWITCHED_EVENT, {
                detail: { hub: updated.activeHub },
              })
            );
          }
        } else {
          setStatus('error', 'Failed to switch hub');
        }
      } catch {
        setStatus('error', 'Failed to switch hub');
      } finally {
        setIsSwitchingHub(false);
      }
    },
    [config.hubs, fetchConfig, setStatus]
  );

  const detectHubByGPS = useCallback(async (): Promise<DetectResult> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return {
        matched_hub: null,
        nearest_hub: null,
        distance_km: null,
        is_within_service_area: false,
        error: 'Geolocation is not supported by your browser.',
      };
    }

    setStatus('locating', 'Detecting nearest hub');

    return new Promise<DetectResult>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));

          try {
            const res = await fetch(
              `/api/hubs/detect?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
              { cache: 'no-store' }
            );
            const data = (await res.json().catch(() => ({}))) as {
              matched_hub?: ServiceHubRecord | null;
              nearest_hub?: ServiceHubRecord | null;
              distance_km?: number | null;
              is_within_service_area?: boolean;
              error?: string;
            };

            if (!res.ok) {
              setStatus('error', 'Location check failed');
              resolve({
                matched_hub: null,
                nearest_hub: null,
                distance_km: null,
                is_within_service_area: false,
                lat,
                lng,
                error: data.error || 'Could not detect nearest hub.',
              });
              return;
            }

            const within = Boolean(data.is_within_service_area);
            if (within && data.matched_hub) {
              setStatus('success', `Matched ${data.matched_hub.name}`);
            } else {
              setStatus('idle');
            }

            resolve({
              matched_hub: data.matched_hub ?? null,
              nearest_hub: data.nearest_hub ?? null,
              distance_km:
                typeof data.distance_km === 'number' ? data.distance_km : null,
              is_within_service_area: within,
              lat,
              lng,
            });
          } catch {
            setStatus('error', 'Network error');
            resolve({
              matched_hub: null,
              nearest_hub: null,
              distance_km: null,
              is_within_service_area: false,
              lat,
              lng,
              error: 'Network error while detecting hub.',
            });
          }
        },
        (err) => {
          setStatus('error', 'GPS unavailable');
          const denied =
            err.code === 1 || /denied|permission/i.test(err.message || '');
          resolve({
            matched_hub: null,
            nearest_hub: null,
            distance_km: null,
            is_within_service_area: false,
            error: denied
              ? 'Location permission denied. Please choose your service hub manually below.'
              : err.message || 'Unable to access GPS coordinates.',
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        }
      );
    });
  }, [setStatus]);

  const activeHubSlug = config.activeHub?.slug || DEFAULT_SERVICE_HUB.slug;

  const dismissHubWelcome = useCallback(() => {
    persistActiveHubSlug(activeHubSlug, true);
    setHasExplicitHubChoice(true);
  }, [activeHubSlug]);

  // Sync dynamic favicon if configured by Super-Admin
  useEffect(() => {
    const faviconUrl = config.app_identity.favicon_url?.trim();
    if (!faviconUrl || typeof document === 'undefined') return;
    if (
      !faviconUrl.startsWith('https://') &&
      !faviconUrl.startsWith('http://') &&
      !faviconUrl.startsWith('/')
    ) {
      return;
    }
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [config.app_identity.favicon_url]);

  const getCategorySubtreeSlugsOrIds = useCallback(
    (categoryId: string | null | undefined, entityType?: CategoryEntityType) =>
      collectCategorySubtree(config.categoriesFlat, categoryId, entityType),
    [config.categoriesFlat]
  );

  const value = useMemo<AppConfigContextValue>(
    () => ({
      config,
      hubs: config.hubs,
      activeHub: config.activeHub,
      hubVehicleRates: config.hubVehicleRates,
      identity: config.app_identity,
      office: config.office_and_contact,
      paymentConfig: config.payment_config,
      operations: config.operations_config,
      surcharges: config.pricing_surcharges,
      legal: config.legal_pages,
      onboardingAndReferrals: config.onboarding_and_referrals,
      supportWhatsApp:
        config.office_and_contact.whatsapp?.trim() ||
        config.onboarding_and_referrals.support_whatsapp?.trim() ||
        config.office_and_contact.phone?.trim() ||
        '',
      categories: config.categories,
      categoriesFlat: config.categoriesFlat,
      categoriesByEntity: config.categoriesByEntity,
      localities: config.localities,
      hubLocalities: config.hubLocalities,
      helpbotFaqs: config.helpbot_faqs,
      announcements: config.announcements,
      banners: config.banners,
      isLoading,
      isSwitchingHub,
      hasExplicitHubChoice,
      switchHub,
      detectHubByGPS,
      dismissHubWelcome,
      getCategorySubtreeSlugsOrIds,
      refreshConfig: (forceFresh = true, hubSlugOverride?: string | null) =>
        fetchConfig(forceFresh, { hubSlug: hubSlugOverride }),
    }),
    [
      config,
      isLoading,
      isSwitchingHub,
      hasExplicitHubChoice,
      switchHub,
      detectHubByGPS,
      dismissHubWelcome,
      getCategorySubtreeSlugsOrIds,
      fetchConfig,
    ]
  );

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig(): AppConfigContextValue {
  return useContext(AppConfigContext);
}

export interface UseHubResult {
  hubs: ServiceHubRecord[];
  activeHub: ServiceHubRecord;
  isSwitchingHub: boolean;
  switchHub: (slug: string) => Promise<void>;
  detectHubByGPS: () => Promise<DetectResult>;
  hasExplicitHubChoice: boolean;
  dismissHubWelcome: () => void;
}

export function useHub(): UseHubResult {
  const {
    hubs,
    activeHub,
    isSwitchingHub,
    switchHub,
    detectHubByGPS,
    hasExplicitHubChoice,
    dismissHubWelcome,
  } = useContext(AppConfigContext);

  return useMemo(
    () => ({
      hubs,
      activeHub,
      isSwitchingHub,
      switchHub,
      detectHubByGPS,
      hasExplicitHubChoice,
      dismissHubWelcome,
    }),
    [
      hubs,
      activeHub,
      isSwitchingHub,
      switchHub,
      detectHubByGPS,
      hasExplicitHubChoice,
      dismissHubWelcome,
    ]
  );
}
