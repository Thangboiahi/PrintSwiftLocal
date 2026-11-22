'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  BedDouble,
  Bookmark,
  Briefcase,
  Building2,
  Calendar,
  Car,
  Clock,
  Compass,
  FileText,
  Flame,
  Gift,
  Globe,
  HeartPulse,
  History,
  Home,
  Info,
  Landmark,
  Languages,
  Layers,
  Loader2,
  MapPin,
  Megaphone,
  MessageSquare,
  Package,
  Palette,
  Phone,
  Printer,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Sparkles,
  Store,
  Trash2,
  Truck,
  User,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useModalLock } from '@/hooks/useModalLock';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import type {
  LandingCivicHighlightItem,
  LandingDishPreviewItem,
  LandingFoodShopItem,
  LandingRealEstateItem,
  LandingVenueStayItem,
} from '@/lib/home/landing-types';
import type {
  LandingBulletinPreview,
  LandingListingPreview,
  LandingMarketPreview,
  LandingVehiclePreview,
} from '@/components/home/LandingClient';

type SearchGroupTab =
  | 'all'
  | 'features'
  | 'places'
  | 'items'
  | 'helplines'
  | 'rides'
  | 'workspace';

type ResultIconKind =
  | 'compass'
  | 'truck'
  | 'printer'
  | 'food'
  | 'shop'
  | 'calendar'
  | 'bed'
  | 'home'
  | 'car'
  | 'civic'
  | 'hospital'
  | 'bulletin'
  | 'activity'
  | 'saved'
  | 'messages'
  | 'user'
  | 'gift'
  | 'palette'
  | 'sliders'
  | 'languages'
  | 'reset'
  | 'briefcase'
  | 'info'
  | 'phone'
  | 'legal'
  | 'pin'
  | 'shield'
  | 'flame'
  | 'package';

interface UniversalSearchResultItem {
  id: string;
  group: Exclude<SearchGroupTab, 'all'>;
  sectionLabel: string;
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
  keywords: string;
  icon: ResultIconKind;
  requiresAuth?: boolean;
}

interface OperationalHatsPayload {
  platform_role: string;
  owned_listings_count: number;
  owned_vehicles_count: number;
  active_staff_assignments: Array<Record<string, unknown>>;
  driver_profile: Record<string, unknown> | null;
  managed_hubs: Array<Record<string, unknown>>;
  is_driver?: boolean;
}

export interface UniversalAppSearchProps {
  query: string;
  onQueryChange: (val: string) => void;
  placeholder: string;
  activeHubId?: string;
  activeHubName: string;
  activeHubSlug?: string;
  localities: string[];
  places: LandingListingPreview[];
  foodAndShops: LandingFoodShopItem[];
  venuesAndStays: LandingVenueStayItem[];
  realEstate: LandingRealEstateItem[];
  civicHighlights: LandingCivicHighlightItem[];
  products: LandingMarketPreview[];
  dishes: LandingDishPreviewItem[];
  vehicles?: LandingVehiclePreview[];
  bulletins?: LandingBulletinPreview[];
  moduleSwitches?: Partial<
    Record<string, boolean | { enabled?: boolean } | undefined>
  >;
  onOpenAuthModal?: () => void;
}

const RECENT_SEARCHES_KEY = 'dd_universal_recent_searches_v1';

const GROUP_TABS: Array<{ id: SearchGroupTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'features', label: 'Features' },
  { id: 'places', label: 'Places' },
  { id: 'items', label: 'Items & Food' },
  { id: 'helplines', label: 'Helplines' },
  { id: 'rides', label: 'Rides' },
  { id: 'workspace', label: 'Workspace' },
];

const POPULAR_QUICK_JUMPS: Array<{
  label: string;
  href: string;
  icon: ResultIconKind;
}> = [
  { label: 'Explore Map', href: '/explore', icon: 'compass' },
  {
    label: 'Send a Parcel',
    href: '/explore?mode=pick_n_drop&serviceType=parcel',
    icon: 'package',
  },
  { label: 'Print & Digital', href: '/explore?vertical=print_digital', icon: 'printer' },
  { label: 'Pure Veg Food', href: '/explore?vertical=restaurant_food&attr=pure_veg', icon: 'food' },
  { label: 'Daily Shops', href: '/marketplace?tab=products', icon: 'shop' },
  { label: '24×7 Hospitals', href: '/civic?category=emergency_medical&open247=1', icon: 'hospital' },
  { label: 'Inter-Hub Rides', href: '/vehicles', icon: 'car' },
  { label: 'Patta Land', href: '/explore?vertical=real_estate&attr=patta_verified', icon: 'home' },
];

function isHubFeatureEnabled(
  switches: UniversalAppSearchProps['moduleSwitches'],
  key?: string
): boolean {
  if (!key || !switches) return true;
  const raw = switches[key];
  if (raw === false) return false;
  if (raw && typeof raw === 'object' && raw.enabled === false) return false;
  return true;
}

function sanitizeIlike(raw: string): string {
  return raw.replace(/[%_,()]/g, ' ').trim();
}

function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function writeRecentSearch(term: string): string[] {
  const clean = term.trim();
  if (!clean || typeof window === 'undefined') return [];
  const next = [
    clean,
    ...readRecentSearches().filter(
      (x) => x.toLowerCase() !== clean.toLowerCase()
    ),
  ].slice(0, 6);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

function clearRecentSearchesStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // ignore
  }
}

function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="rounded bg-[var(--ps-accent)]/20 px-0.5 font-bold text-[var(--ps-text)]">
        {match}
      </mark>
      {after}
    </>
  );
}

function ResultGlyph({ kind }: { kind: ResultIconKind }) {
  const cls = 'h-4 w-4 shrink-0';
  switch (kind) {
    case 'compass':
      return <Compass className={cls} />;
    case 'truck':
      return <Truck className={cls} />;
    case 'package':
      return <Package className={cls} />;
    case 'flame':
      return <Flame className={cls} />;
    case 'printer':
      return <Printer className={cls} />;
    case 'food':
      return <UtensilsCrossed className={cls} />;
    case 'shop':
      return <ShoppingBag className={cls} />;
    case 'calendar':
      return <Calendar className={cls} />;
    case 'bed':
      return <BedDouble className={cls} />;
    case 'home':
      return <Home className={cls} />;
    case 'car':
      return <Car className={cls} />;
    case 'civic':
      return <Landmark className={cls} />;
    case 'hospital':
      return <HeartPulse className={cls} />;
    case 'bulletin':
      return <Megaphone className={cls} />;
    case 'activity':
      return <Clock className={cls} />;
    case 'saved':
      return <Bookmark className={cls} />;
    case 'messages':
      return <MessageSquare className={cls} />;
    case 'user':
      return <User className={cls} />;
    case 'gift':
      return <Gift className={cls} />;
    case 'palette':
      return <Palette className={cls} />;
    case 'sliders':
      return <Sliders className={cls} />;
    case 'languages':
      return <Languages className={cls} />;
    case 'reset':
      return <RotateCcw className={cls} />;
    case 'briefcase':
      return <Briefcase className={cls} />;
    case 'info':
      return <Info className={cls} />;
    case 'phone':
      return <Phone className={cls} />;
    case 'legal':
      return <FileText className={cls} />;
    case 'shield':
      return <ShieldCheck className={cls} />;
    default:
      return <MapPin className={cls} />;
  }
}

export function UniversalAppSearch({
  query,
  onQueryChange,
  placeholder,
  activeHubId = '',
  activeHubName,
  localities,
  places,
  foodAndShops,
  venuesAndStays,
  realEstate,
  civicHighlights,
  products,
  dishes,
  vehicles = [],
  bulletins = [],
  moduleSwitches,
  onOpenAuthModal,
}: UniversalAppSearchProps) {
  const router = useRouter();
  const { user, role, realRole } = useAuth();

  const [isDesktopOpen, setIsDesktopOpen] = useState(false);
  const [isMobileOverlayOpen, setIsMobileOverlayOpen] = useState(false);
  const [activeGroupTab, setActiveGroupTab] = useState<SearchGroupTab>('all');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    readRecentSearches()
  );
  const [isDbFetching, setIsDbFetching] = useState(false);
  const [dbResults, setDbResults] = useState<UniversalSearchResultItem[]>([]);
  const [hats, setHats] = useState<OperationalHatsPayload | null>(null);
  const [visualViewportHeight, setVisualViewportHeight] = useState<number>(
    640
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const desktopInputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const hatsFetchedUserRef = useRef<string>('');
  const dbRequestSeqRef = useRef<number>(0);

  useModalLock(isMobileOverlayOpen);

  const isAuthenticated = Boolean(user?.id);

  // Visual viewport awareness so mobile overlay stays 100% visible above keyboard
  useEffect(() => {
    if (typeof window === 'undefined' || !isMobileOverlayOpen) return;
    const updateViewport = () => {
      const h = window.visualViewport?.height || window.innerHeight || 640;
      setVisualViewportHeight(Math.round(h));
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [isMobileOverlayOpen]);

  // Focus mobile overlay input cleanly on open
  useEffect(() => {
    if (!isMobileOverlayOpen) return;
    const t = window.setTimeout(() => {
      mobileInputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(t);
  }, [isMobileOverlayOpen]);

  // Close desktop dropdown on outside click
  useEffect(() => {
    const onMouseDown = (ev: MouseEvent) => {
      if (!containerRef.current?.contains(ev.target as Node)) {
        setIsDesktopOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Global keyboard shortcuts: Cmd/Ctrl+K or '/' focuses search
  useEffect(() => {
    const onGlobalKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const isTypingTarget =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        if (window.innerWidth < 640) {
          setIsMobileOverlayOpen(true);
        } else {
          desktopInputRef.current?.focus();
          setIsDesktopOpen(true);
        }
        return;
      }

      if (ev.key === '/' && !isTypingTarget && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault();
        if (window.innerWidth < 640) {
          setIsMobileOverlayOpen(true);
        } else {
          desktopInputRef.current?.focus();
          setIsDesktopOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  // Fetch user's real operational hats once per user.id (strictly permission-gated)
  useEffect(() => {
    const uid = user?.id || '';
    if (!uid || !isSupabaseConfigured()) {
      hatsFetchedUserRef.current = '';
      setHats(null);
      return;
    }
    if (hatsFetchedUserRef.current === uid) return;

    let active = true;
    const loadHats = async () => {
      try {
        const { data, error } = await supabase.rpc('get_user_operational_hats', {
          p_user_id: uid,
        });
        if (!active || error || !data || typeof data !== 'object') return;
        const raw = data as Record<string, unknown>;
        hatsFetchedUserRef.current = uid;
        setHats({
          platform_role: String(raw.platform_role || role || 'visitor'),
          owned_listings_count: Number(raw.owned_listings_count ?? 0),
          owned_vehicles_count: Number(raw.owned_vehicles_count ?? 0),
          active_staff_assignments: Array.isArray(raw.active_staff_assignments)
            ? (raw.active_staff_assignments as Array<Record<string, unknown>>)
            : [],
          driver_profile:
            raw.driver_profile && typeof raw.driver_profile === 'object'
              ? (raw.driver_profile as Record<string, unknown>)
              : null,
          managed_hubs: Array.isArray(raw.managed_hubs)
            ? (raw.managed_hubs as Array<Record<string, unknown>>)
            : [],
          is_driver: raw.is_driver === true,
        });
      } catch {
        // Non-blocking fallback
      }
    };
    void loadHats();
    return () => {
      active = false;
    };
  }, [user?.id, role]);

  // Instant Client Index: App Features, Pages & Settings + Permitted Workspace Shortcuts
  const staticFeatureItems = useMemo<UniversalSearchResultItem[]>(() => {
    const features: UniversalSearchResultItem[] = [
      {
        id: 'feat-explore',
        group: 'features',
        sectionLabel: 'App Features & Pages',
        title: 'Explore Map',
        subtitle: `Interactive map & live directory in ${activeHubName}`,
        href: '/explore',
        badge: 'Map',
        keywords: 'explore map directory near me locations pins',
        icon: 'compass',
      },
      ...(isHubFeatureEnabled(moduleSwitches, 'pick_n_drop')
        ? [
            {
              id: 'feat-pnd-parcel',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Pick N Drop — Send Parcel',
              subtitle: 'Same-day local courier, documents & shop pickup',
              href: '/explore?mode=pick_n_drop&serviceType=parcel',
              badge: 'Pick N Drop',
              keywords: 'pick n drop parcel courier delivery package send',
              icon: 'package' as const,
            },
            {
              id: 'feat-pnd-ride',
              group: 'rides' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Pick N Drop — Local Ride / Auto',
              subtitle: 'Point-to-point passenger rides around town',
              href: '/explore?mode=pick_n_drop&serviceType=ride',
              badge: 'Ride',
              keywords: 'pick n drop ride auto taxi cab passenger two wheeler',
              icon: 'truck' as const,
            },
            {
              id: 'feat-pnd-lpg',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Pick N Drop — LPG Gas Delivery',
              subtitle: 'Cylinder pickup, refill & return to doorstep',
              href: '/explore?mode=pick_n_drop&serviceType=lpg',
              badge: 'LPG',
              keywords: 'pick n drop lpg gas cylinder refill agency delivery',
              icon: 'flame' as const,
            },
          ]
        : []),
      ...(isHubFeatureEnabled(moduleSwitches, 'print_orders')
        ? [
            {
              id: 'feat-print',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Print & Digital Services',
              subtitle: 'Upload PDFs, bind, laminate & track print queue',
              href: '/explore?vertical=print_digital',
              badge: 'Vertical',
              keywords: 'print digital xerox binding lamination pdf photo counter',
              icon: 'printer' as const,
            },
          ]
        : []),
      ...(isHubFeatureEnabled(moduleSwitches, 'food_orders')
        ? [
            {
              id: 'feat-food',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Food & Cafés',
              subtitle: 'Browse menus, table booking & hot-food delivery',
              href: '/explore?vertical=restaurant_food',
              badge: 'Vertical',
              keywords: 'food restaurant cafe coffee dining pure veg takeaway table',
              icon: 'food' as const,
            },
          ]
        : []),
      ...(isHubFeatureEnabled(moduleSwitches, 'shop_orders')
        ? [
            {
              id: 'feat-shops',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Daily Shops & Marketplace',
              subtitle: 'Groceries, local goods, electronics & store catalogues',
              href: '/marketplace?tab=products',
              badge: 'Marketplace',
              keywords: 'daily shops marketplace store buy grocery product catalogue',
              icon: 'shop' as const,
            },
          ]
        : []),
      ...(isHubFeatureEnabled(moduleSwitches, 'booking_venues')
        ? [
            {
              id: 'feat-turfs',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Turfs & Community Halls',
              subtitle: 'Check hourly slot calendars & reserve online',
              href: '/bookings?tab=venues',
              badge: 'Bookings',
              keywords: 'turf futsal ground badminton hall venue booking hourly slots',
              icon: 'calendar' as const,
            },
          ]
        : []),
      ...(isHubFeatureEnabled(moduleSwitches, 'hotel_stays')
        ? [
            {
              id: 'feat-hotels',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Hotels & Stays',
              subtitle: 'Guesthouses, rooms & verified homestays',
              href: '/bookings?tab=stays',
              badge: 'Bookings',
              keywords: 'hotel stay lodge homestay room guest house check in',
              icon: 'bed' as const,
            },
          ]
        : []),
      ...(isHubFeatureEnabled(moduleSwitches, 'real_estate')
        ? [
            {
              id: 'feat-realestate',
              group: 'features' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Real Estate & Land',
              subtitle: 'Homes for rent, commercial spaces & Patta plots',
              href: '/explore?vertical=real_estate',
              badge: 'Property',
              keywords: 'real estate house rent land plot patta verified property',
              icon: 'home' as const,
            },
          ]
        : []),
      {
        id: 'feat-bookings-hub',
        group: 'features',
        sectionLabel: 'App Features & Pages',
        title: 'Scheduled Bookings Hub',
        subtitle: 'Bus, Sumo, turfs, stays, events & table reservations',
        href: '/bookings',
        badge: 'Hub',
        keywords: 'bookings hub scheduled bus sumo turf hotel stays events tables reserve',
        icon: 'calendar',
      },
      {
        id: 'feat-events-tickets',
        group: 'features',
        sectionLabel: 'App Features & Pages',
        title: 'Events & Tickets',
        subtitle: 'Upcoming concerts, workshops, tournaments & RSVPs',
        href: '/bookings?tab=events',
        badge: 'Bookings',
        keywords: 'events tickets concert workshop tournament festival rsvp',
        icon: 'calendar',
      },
      ...(isHubFeatureEnabled(moduleSwitches, 'scheduled_vehicles')
        ? [
            {
              id: 'feat-vehicles',
              group: 'rides' as const,
              sectionLabel: 'App Features & Pages',
              title: 'Inter-Hub Vehicles',
              subtitle: 'Scheduled Sumo, Cruiser, mini-van & per-seat rides',
              href: '/bookings?tab=vehicles',
              badge: 'Travel',
              keywords: 'inter hub vehicles sumo cruiser cab minivan shifting aizawl bus',
              icon: 'car' as const,
            },
          ]
        : []),
      {
        id: 'feat-civic',
        group: 'helplines',
        sectionLabel: 'App Features & Pages',
        title: 'Emergency & Civic Helplines',
        subtitle: '24×7 hospitals, police, govt offices & checklists',
        href: '/civic',
        badge: 'Civic',
        keywords: 'emergency hospital police fire civic helpline govt checklist dc office',
        icon: 'hospital',
      },
      {
        id: 'feat-bulletin',
        group: 'features',
        sectionLabel: 'App Features & Pages',
        title: 'Community Bulletin',
        subtitle: 'Local jobs, classifieds, events & public notices',
        href: '/bulletin',
        badge: 'Bulletin',
        keywords: 'community bulletin notices jobs events announcements classifieds',
        icon: 'bulletin',
      },
      {
        id: 'feat-activity',
        group: 'features',
        sectionLabel: 'Your Account & Shortcuts',
        title: 'Activity & Orders',
        subtitle: 'Track deliveries, OTPs, print jobs & UPI receipts',
        href: '/activity',
        badge: 'Orders',
        keywords: 'activity orders tracking receipts otp history bookings',
        icon: 'activity',
      },
      {
        id: 'feat-saved',
        group: 'features',
        sectionLabel: 'Your Account & Shortcuts',
        title: 'Saved & Bookmarks',
        subtitle: 'Quickly revisit pinned shops, properties & contacts',
        href: '/saved',
        keywords: 'saved bookmarks favourites pins',
        icon: 'saved',
      },
      {
        id: 'feat-messages',
        group: 'features',
        sectionLabel: 'Your Account & Shortcuts',
        title: 'Messages & Enquiries',
        subtitle: 'Direct chats with shop owners, landlords & drivers',
        href: '/messages',
        keywords: 'messages chat inbox enquiries conversations',
        icon: 'messages',
      },
      {
        id: 'feat-profile',
        group: 'features',
        sectionLabel: 'Your Account & Shortcuts',
        title: 'Profile & Account',
        subtitle: 'Edit display name, avatar & contact number',
        href: '/profile',
        keywords: 'profile account user settings',
        icon: 'user',
      },
      {
        id: 'feat-refer',
        group: 'features',
        sectionLabel: 'Your Account & Shortcuts',
        title: 'Refer & Earn',
        subtitle: 'Share your referral link to earn local rewards',
        href: '/profile#referrals',
        badge: 'Earn',
        keywords: 'refer earn referral invite reward points',
        icon: 'gift',
        requiresAuth: true,
      },
      {
        id: 'feat-theme',
        group: 'features',
        sectionLabel: 'Settings & Preferences',
        title: 'Theme & Display',
        subtitle: 'Switch between Light, Soft & Dark color themes',
        href: '/settings#theme',
        badge: 'Settings',
        keywords: 'theme dark light soft mode display appearance color',
        icon: 'palette',
      },
      {
        id: 'feat-scale',
        group: 'features',
        sectionLabel: 'Settings & Preferences',
        title: 'UI Scale',
        subtitle: 'Adjust Compact, Medium, or Spacious interface sizing',
        href: '/settings#scale',
        badge: 'Settings',
        keywords: 'ui scale size compact medium large accessibility zoom',
        icon: 'sliders',
      },
      {
        id: 'feat-language',
        group: 'features',
        sectionLabel: 'Settings & Preferences',
        title: 'Language',
        subtitle: 'Choose your preferred interface language',
        href: '/settings#language',
        badge: 'Settings',
        keywords: 'language translate english mizo paite thadou',
        icon: 'languages',
      },
      {
        id: 'feat-tutorials',
        group: 'features',
        sectionLabel: 'Settings & Preferences',
        title: 'Restart Tutorials',
        subtitle: 'Replay interactive page walkthrough guides',
        href: '/settings#tutorials',
        badge: 'Help',
        keywords: 'restart tutorials onboarding guide help walkthrough',
        icon: 'reset',
      },
      {
        id: 'feat-onboarding',
        group: 'features',
        sectionLabel: 'Grow with DD oodle',
        title: 'Partner / Driver Application',
        subtitle: 'List your business, fleet vehicle, or apply to drive',
        href: '/onboarding',
        badge: 'Apply',
        keywords: 'partner driver application apply list business vendor shop',
        icon: 'briefcase',
      },
      {
        id: 'feat-about',
        group: 'features',
        sectionLabel: 'Info & Legal',
        title: 'About DD oodle',
        subtitle: 'How the hyperlocal discovery & escrow network works',
        href: '/about',
        keywords: 'about dd oodle platform team story',
        icon: 'info',
      },
      {
        id: 'feat-contact',
        group: 'features',
        sectionLabel: 'Info & Legal',
        title: 'Contact Support',
        subtitle: 'Reach hub coordinators & customer care',
        href: '/contact',
        keywords: 'contact support helpdesk phone email',
        icon: 'phone',
      },
      {
        id: 'feat-terms',
        group: 'features',
        sectionLabel: 'Info & Legal',
        title: 'Terms & Privacy Policy',
        subtitle: 'Platform terms, refund rules & data privacy',
        href: '/legal/terms',
        keywords: 'legal terms privacy refund policy escrow compliance',
        icon: 'legal',
      },
    ];

    // Localities inside active hub
    for (const loc of localities) {
      features.push({
        id: `loc-${loc.toLowerCase().replace(/\s+/g, '-')}`,
        group: 'places',
        sectionLabel: `Localities in ${activeHubName}`,
        title: loc,
        subtitle: `Filter map pins & shops in ${loc}`,
        href: `/explore?locality=${encodeURIComponent(loc)}`,
        badge: 'Locality',
        keywords: `${loc} locality area neighborhood ward`,
        icon: 'pin',
      });
    }

    return features;
  }, [activeHubName, localities, moduleSwitches]);

  // Permission-Gated Workspace Shortcuts (Strictly Hat-Gated, Zero components/workspaces imports)
  const permittedWorkspaceItems = useMemo<UniversalSearchResultItem[]>(() => {
    if (!isAuthenticated) return [];
    const effectiveRole = (role || 'visitor').toLowerCase();
    const real = (realRole || effectiveRole).toLowerCase();

    const hasOwnerHat =
      (hats?.owned_listings_count ?? 0) > 0 ||
      (hats?.owned_vehicles_count ?? 0) > 0 ||
      effectiveRole === 'owner';
    const hasStaffHat =
      (hats?.active_staff_assignments?.length ?? 0) > 0 ||
      effectiveRole === 'staff';
    const hasDriverHat =
      Boolean(hats?.driver_profile) ||
      hats?.is_driver === true ||
      effectiveRole === 'driver';
    const hasHubManagerHat =
      (hats?.managed_hubs?.length ?? 0) > 0 ||
      effectiveRole === 'hub_manager';
    const hasSuperAdminHat =
      hats?.platform_role === 'super_admin' ||
      real === 'super_admin' ||
      effectiveRole === 'super_admin' ||
      effectiveRole === 'admin';

    const list: UniversalSearchResultItem[] = [];

    if (hasOwnerHat) {
      list.push(
        {
          id: 'ws-owner-listings',
          group: 'workspace',
          sectionLabel: 'Owner Workspace',
          title: 'My Listings & Storefronts',
          subtitle: 'Manage business details, media & catalog visibility',
          href: '/workspace?hat=owner&tab=listings',
          badge: 'Owner',
          keywords: 'workspace owner my listings business store manage edit',
          icon: 'briefcase',
        },
        {
          id: 'ws-owner-print',
          group: 'workspace',
          sectionLabel: 'Owner Workspace',
          title: 'Print Queue',
          subtitle: 'Process uploaded customer print jobs & mark ready',
          href: '/workspace?hat=owner&tab=print_orders',
          badge: 'Owner',
          keywords: 'workspace print queue orders owner pdf counter',
          icon: 'printer',
        },
        {
          id: 'ws-owner-orders',
          group: 'workspace',
          sectionLabel: 'Owner Workspace',
          title: 'Kitchen & Shop Orders',
          subtitle: 'Accept, prepare & fulfill live store/restaurant orders',
          href: '/workspace?hat=owner&tab=orders',
          badge: 'Owner',
          keywords: 'workspace kitchen shop orders owner food ecommerce',
          icon: 'shop',
        },
        {
          id: 'ws-owner-bookings',
          group: 'workspace',
          sectionLabel: 'Owner Workspace',
          title: 'Bookings & Calendar',
          subtitle: 'Slot schedules, walk-in blocks & stay reservations',
          href: '/workspace?hat=owner&tab=bookings',
          badge: 'Owner',
          keywords: 'workspace bookings calendar slots reservations owner turf hotel',
          icon: 'calendar',
        },
        {
          id: 'ws-owner-staff',
          group: 'workspace',
          sectionLabel: 'Owner Workspace',
          title: 'Staff Team & Scopes',
          subtitle: 'Invite team members & manage vertical permissions',
          href: '/workspace?hat=owner&tab=staff',
          badge: 'Owner',
          keywords: 'workspace staff team delegation permissions owner',
          icon: 'user',
        },
        {
          id: 'ws-owner-subs',
          group: 'workspace',
          sectionLabel: 'Owner Workspace',
          title: 'Subscriptions & Quotas',
          subtitle: 'Active plans, feature access & listing limits',
          href: '/workspace?hat=owner&tab=subscription',
          badge: 'Owner',
          keywords: 'workspace subscriptions quotas plan upgrade billing owner',
          icon: 'shield',
        }
      );
    }

    if (hasStaffHat) {
      list.push({
        id: 'ws-staff-desk',
        group: 'workspace',
        sectionLabel: 'Staff Workspace',
        title: 'Staff Desk',
        subtitle: 'Delegated counter, order & slot operations',
        href: '/workspace?hat=staff',
        badge: 'Staff',
        keywords: 'workspace staff desk counter delegated tasks',
        icon: 'briefcase',
      });
    }

    if (hasDriverHat) {
      list.push(
        {
          id: 'ws-driver-dispatch',
          group: 'workspace',
          sectionLabel: 'Driver Console',
          title: 'Driver Dispatch & Jobs',
          subtitle: 'Live Pick N Drop pickup/dropoff OTP verification',
          href: '/workspace?hat=driver',
          badge: 'Driver',
          keywords: 'workspace driver dispatch pick n drop jobs otp',
          icon: 'truck',
        },
        {
          id: 'ws-driver-payouts',
          group: 'workspace',
          sectionLabel: 'Driver Console',
          title: 'Online Status & Payouts',
          subtitle: 'Toggle duty shift & review completed ride earnings',
          href: '/workspace?hat=driver&tab=payouts',
          badge: 'Driver',
          keywords: 'workspace driver online status payouts earnings',
          icon: 'shield',
        }
      );
    }

    if (hasHubManagerHat) {
      list.push(
        {
          id: 'ws-hub-approvals',
          group: 'workspace',
          sectionLabel: 'Hub Manager',
          title: 'Hub Approvals Queue',
          subtitle: 'Review new business listings & verification updates',
          href: '/workspace?hat=hub_manager&tab=approvals',
          badge: 'Manager',
          keywords: 'workspace hub manager approvals listings review',
          icon: 'shield',
        },
        {
          id: 'ws-hub-civic',
          group: 'workspace',
          sectionLabel: 'Hub Manager',
          title: 'Civic Directory Manager',
          subtitle: 'Verify helplines, emergency flags & document checklists',
          href: '/workspace?hat=hub_manager&tab=civic',
          badge: 'Manager',
          keywords: 'workspace hub manager civic directory helplines alerts',
          icon: 'civic',
        },
        {
          id: 'ws-hub-kyc',
          group: 'workspace',
          sectionLabel: 'Hub Manager',
          title: 'KYC & Partner Review Queue',
          subtitle: 'Inspect partner applications, KYC docs & rejections',
          href: '/workspace?hat=hub_manager&tab=kyc',
          badge: 'Manager',
          keywords: 'workspace hub manager kyc onboarding partner queue',
          icon: 'briefcase',
        },
        {
          id: 'ws-hub-featured',
          group: 'workspace',
          sectionLabel: 'Hub Manager',
          title: 'Featured Slots & Promotions',
          subtitle: 'Approve homepage spotlights & manage expiry dates',
          href: '/workspace?hat=hub_manager&tab=featured',
          badge: 'Manager',
          keywords: 'workspace hub manager featured slots monetization banners',
          icon: 'shield',
        },
        {
          id: 'ws-hub-referrals',
          group: 'workspace',
          sectionLabel: 'Hub Manager',
          title: 'Referrals & Payout Ledger',
          subtitle: 'Monitor hub referral rewards & settlement status',
          href: '/workspace?hat=hub_manager&tab=referrals',
          badge: 'Manager',
          keywords: 'workspace hub manager referrals ledger rewards',
          icon: 'gift',
        }
      );
    }

    if (hasSuperAdminHat) {
      list.push(
        {
          id: 'ws-admin-master',
          group: 'workspace',
          sectionLabel: 'Super-Admin Control',
          title: 'Master Control Panel',
          subtitle: 'Global hubs, module switches & super-admin overrides',
          href: '/workspace?hat=master_control',
          badge: 'Admin',
          keywords: 'workspace super admin master control panel global switches',
          icon: 'shield',
        },
        {
          id: 'ws-admin-plans',
          group: 'workspace',
          sectionLabel: 'Super-Admin Control',
          title: 'Composable Plans & Entitlements',
          subtitle: 'Configure SaaS tiers, limits & manual overrides',
          href: '/workspace?hat=master_control&tab=plans',
          badge: 'Admin',
          keywords: 'workspace super admin composable plans entitlements overrides',
          icon: 'sliders',
        },
        {
          id: 'ws-admin-custody',
          group: 'workspace',
          sectionLabel: 'Super-Admin Control',
          title: 'Loose-Ends & Custody Ledger',
          subtitle: 'Resolve escrow holds, UTR audits & dispute refunds',
          href: '/workspace?hat=master_control&tab=custody',
          badge: 'Admin',
          keywords: 'workspace super admin loose ends custody escrow utr',
          icon: 'legal',
        },
        {
          id: 'ws-admin-media',
          group: 'workspace',
          sectionLabel: 'Super-Admin Control',
          title: 'Media Storage Sweeper',
          subtitle: 'Purge orphaned temp assets & inspect bucket health',
          href: '/workspace?hat=master_control&tab=media',
          badge: 'Admin',
          keywords: 'workspace super admin media sweeper storage purge',
          icon: 'reset',
        },
        {
          id: 'ws-admin-brand',
          group: 'workspace',
          sectionLabel: 'Super-Admin Control',
          title: 'Brand SVG Logo & Identity',
          subtitle: 'Customize global emblem vector, tagline & announcement bar',
          href: '/workspace?hat=master_control&tab=brand',
          badge: 'Admin',
          keywords: 'workspace super admin brand svg logo identity announcement',
          icon: 'palette',
        }
      );
    }

    return list;
  }, [isAuthenticated, role, realRole, hats]);

  // Snapshot items merged immediately (instantaneous on first keystroke)
  const snapshotItems = useMemo<UniversalSearchResultItem[]>(() => {
    const out: UniversalSearchResultItem[] = [];
    const seenPlaceIds = new Set<string>();

    for (const item of foodAndShops) {
      seenPlaceIds.add(item.id);
      const clean = splitSamplePrefix(item.title).title || item.title;
      out.push({
        id: `snap-fs-${item.id}`,
        group: 'places',
        sectionLabel: `Places in ${activeHubName}`,
        title: clean,
        subtitle: item.locality,
        href: `/listing/${encodeURIComponent(item.id)}`,
        badge: item.vertical === 'restaurant_food' ? 'Menu' : 'Store',
        keywords: `${clean} ${item.locality} ${item.vertical}`,
        icon: item.vertical === 'restaurant_food' ? 'food' : 'shop',
      });
    }
    for (const item of venuesAndStays) {
      if (seenPlaceIds.has(item.id)) continue;
      seenPlaceIds.add(item.id);
      const clean = splitSamplePrefix(item.title).title || item.title;
      out.push({
        id: `snap-vs-${item.id}`,
        group: 'places',
        sectionLabel: `Places in ${activeHubName}`,
        title: clean,
        subtitle: item.locality,
        href:
          item.vertical === 'booking_venue'
            ? `/listing/${encodeURIComponent(item.id)}/book`
            : `/listing/${encodeURIComponent(item.id)}`,
        badge: item.vertical === 'booking_venue' ? 'Book Slot' : 'Stay',
        keywords: `${clean} ${item.locality} ${item.vertical}`,
        icon: item.vertical === 'booking_venue' ? 'calendar' : 'bed',
      });
    }
    for (const item of realEstate) {
      if (seenPlaceIds.has(item.id)) continue;
      seenPlaceIds.add(item.id);
      const clean = splitSamplePrefix(item.title).title || item.title;
      out.push({
        id: `snap-re-${item.id}`,
        group: 'places',
        sectionLabel: `Places in ${activeHubName}`,
        title: clean,
        subtitle: item.locality,
        href: `/listing/${encodeURIComponent(item.id)}`,
        badge: formatIndianPropertyPrice(item.priceInr, item.pricePeriod),
        keywords: `${clean} ${item.locality} ${item.transactionType} real estate land plot`,
        icon: 'home',
      });
    }
    for (const item of places) {
      if (seenPlaceIds.has(item.id)) continue;
      seenPlaceIds.add(item.id);
      const clean = splitSamplePrefix(item.title).title || item.title;
      out.push({
        id: `snap-pl-${item.id}`,
        group: 'places',
        sectionLabel: `Places in ${activeHubName}`,
        title: clean,
        subtitle: item.locality,
        href: `/listing/${encodeURIComponent(item.id)}`,
        badge: item.category.replace(/_/g, ' '),
        keywords: `${clean} ${item.locality} ${item.category} ${item.subcategory}`,
        icon: item.category === 'public_place' ? 'civic' : 'pin',
      });
    }
    for (const c of civicHighlights) {
      const clean = splitSamplePrefix(c.title).title || c.title;
      out.push({
        id: `snap-civic-${c.id}`,
        group: 'helplines',
        sectionLabel: 'Public & Emergency Helplines',
        title: clean,
        subtitle: c.primaryPhone
          ? `${c.locality} • ${c.primaryPhone}`
          : c.locality,
        href: `/explore?civic=${encodeURIComponent(c.id)}`,
        badge: c.is24x7 ? '24×7' : c.departmentType.replace(/_/g, ' '),
        keywords: `${clean} ${c.locality} ${c.departmentType} ${c.primaryPhone || ''} hospital police civic`,
        icon: c.departmentType === 'emergency_medical' ? 'hospital' : 'civic',
      });
    }
    for (const d of dishes) {
      const clean = splitSamplePrefix(d.name).title || d.name;
      out.push({
        id: `snap-dish-${d.id}`,
        group: 'items',
        sectionLabel: 'Items & Food Dishes',
        title: clean,
        subtitle: `${splitSamplePrefix(d.restaurantName).title || d.restaurantName} · ₹${Math.round(d.priceInr)}`,
        href: `/listing/${encodeURIComponent(d.listingId)}?item=${encodeURIComponent(d.id)}`,
        badge: `₹${Math.round(d.priceInr)}`,
        keywords: `${clean} ${d.restaurantName} ${d.dietaryType} dish menu`,
        icon: 'food',
      });
    }
    for (const p of products) {
      const clean = splitSamplePrefix(p.title).title || p.title;
      out.push({
        id: `snap-prod-${p.id}`,
        group: 'items',
        sectionLabel: 'Items & Food Dishes',
        title: clean,
        subtitle: `${splitSamplePrefix(p.shopName).title || p.shopName} · ₹${Math.round(p.price)}`,
        href: p.listingId
          ? `/listing/${encodeURIComponent(p.listingId)}?item=${encodeURIComponent(p.id)}`
          : `/marketplace?q=${encodeURIComponent(clean)}`,
        badge: `₹${Math.round(p.price)}`,
        keywords: `${clean} ${p.shopName} ${p.category} product`,
        icon: 'shop',
      });
    }
    for (const v of vehicles) {
      const clean = splitSamplePrefix(v.title).title || v.title;
      out.push({
        id: `snap-veh-${v.id}`,
        group: 'rides',
        sectionLabel: 'Scheduled Vehicles & Rides',
        title: clean,
        subtitle: `${v.standLocality}${v.startingPriceInr > 0 ? ` · From ₹${v.startingPriceInr}${v.startingPriceUnit}` : ''}`,
        href: `/vehicles/${encodeURIComponent(v.id)}`,
        badge: v.bookingMode === 'per_seat' ? 'Per Seat' : 'Vehicle',
        keywords: `${clean} ${v.standLocality} vehicle sumo bus taxi ride`,
        icon: 'car',
      });
    }
    for (const b of bulletins) {
      const clean = splitSamplePrefix(b.title).title || b.title;
      out.push({
        id: `snap-bul-${b.id}`,
        group: 'features',
        sectionLabel: 'Community Bulletins',
        title: clean,
        subtitle: `${b.category.toUpperCase()} · ${b.excerpt || b.authorName}`,
        href: '/bulletin',
        badge: b.category,
        keywords: `${clean} ${b.excerpt} ${b.category} ${b.authorName} bulletin notice`,
        icon: 'bulletin',
      });
    }

    return out;
  }, [
    activeHubName,
    bulletins,
    civicHighlights,
    dishes,
    foodAndShops,
    places,
    products,
    realEstate,
    vehicles,
    venuesAndStays,
  ]);

  // 160ms Debounced Batched Hub-Aware Supabase Search across all live entities
  useEffect(() => {
    const clean = sanitizeIlike(query);
    if (clean.length < 2 || !isSupabaseConfigured()) {
      setIsDbFetching(false);
      setDbResults([]);
      return;
    }

    const seq = ++dbRequestSeqRef.current;
    setIsDbFetching(true);

    const timer = window.setTimeout(async () => {
      try {
        const pattern = `%${clean}%`;
        const hasHubFilter = Boolean(
          activeHubId && !activeHubId.startsWith('fallback-')
        );

        let listingsQ = supabase
          .from('listings')
          .select('id, hub_id, title, category, subcategory, locality, listing_vertical')
          .eq('status', 'published')
          .eq('lifecycle_status', 'active')
          .or(
            `title.ilike.${pattern},locality.ilike.${pattern},subcategory.ilike.${pattern}`
          )
          .limit(8);

        let productsQ = supabase
          .from('marketplace_products')
          .select(
            'id, listing_id, title, price, category, listings!inner(id, hub_id, title, locality, lifecycle_status)'
          )
          .eq('is_active', true)
          .eq('listings.lifecycle_status', 'active')
          .ilike('title', pattern)
          .limit(6);

        let dishesQ = supabase
          .from('restaurant_menu_items')
          .select(
            'id, listing_id, name, base_price_inr, dietary_type, listings!inner(id, hub_id, title, lifecycle_status)'
          )
          .eq('in_stock', true)
          .eq('listings.lifecycle_status', 'active')
          .ilike('name', pattern)
          .limit(6);

        let civicQ = supabase
          .from('listing_civic_profiles')
          .select(
            'listing_id, department_type, is_24x7, helplines, listings!inner(id, hub_id, title, locality, status, lifecycle_status)'
          )
          .eq('listings.lifecycle_status', 'active')
          .limit(8);

        let vehiclesQ = supabase
          .from('vehicle_listings')
          .select('id, origin_hub_id, destination_hub_ids, title, stand_locality, booking_mode, is_active')
          .eq('is_active', true)
          .or(`title.ilike.${pattern},stand_locality.ilike.${pattern}`)
          .limit(5);

        let bulletinsQ = supabase
          .from('bulletins')
          .select('id, title, excerpt, category, is_global, target_hub_ids')
          .in('status', ['published', 'active'])
          .or(`title.ilike.${pattern},excerpt.ilike.${pattern}`)
          .limit(4);

        if (hasHubFilter) {
          listingsQ = listingsQ.eq('hub_id', activeHubId);
          productsQ = productsQ.eq('listings.hub_id', activeHubId);
          dishesQ = dishesQ.eq('listings.hub_id', activeHubId);
          civicQ = civicQ.eq('listings.hub_id', activeHubId);
          vehiclesQ = vehiclesQ.or(
            `origin_hub_id.eq.${activeHubId},destination_hub_ids.cs.{${activeHubId}}`
          );
          bulletinsQ = bulletinsQ.or(
            `is_global.eq.true,target_hub_ids.cs.{${activeHubId}}`
          );
        }

        const [
          listingsRes,
          productsRes,
          dishesRes,
          civicRes,
          vehiclesRes,
          bulletinsRes,
        ] = await Promise.allSettled([
          listingsQ,
          productsQ,
          dishesQ,
          civicQ,
          vehiclesQ,
          bulletinsQ,
        ]);

        if (seq !== dbRequestSeqRef.current) return;

        const gathered: UniversalSearchResultItem[] = [];

        if (
          listingsRes.status === 'fulfilled' &&
          !listingsRes.value.error &&
          Array.isArray(listingsRes.value.data)
        ) {
          for (const row of listingsRes.value.data as Array<Record<string, unknown>>) {
            const id = String(row.id || '');
            if (!id) continue;
            const rawTitle = String(row.title || '');
            const cleanTitle = splitSamplePrefix(rawTitle).title || rawTitle;
            const loc = String(row.locality || activeHubName);
            const vert = String(row.listing_vertical || row.category || '');
            const isCivic = vert === 'public_civic' || row.category === 'public_place';
            gathered.push({
              id: `db-list-${id}`,
              group: isCivic ? 'helplines' : 'places',
              sectionLabel: isCivic
                ? 'Public & Emergency Helplines'
                : `Places in ${activeHubName}`,
              title: cleanTitle,
              subtitle: loc,
              href: isCivic
                ? `/explore?civic=${encodeURIComponent(id)}`
                : `/listing/${encodeURIComponent(id)}`,
              badge: String(row.subcategory || vert || 'Place').replace(/_/g, ' '),
              keywords: `${cleanTitle} ${loc} ${vert}`,
              icon: isCivic
                ? 'civic'
                : vert === 'print_digital'
                  ? 'printer'
                  : vert === 'restaurant_food'
                    ? 'food'
                    : vert === 'booking_venue'
                      ? 'calendar'
                      : vert === 'hotel_stay'
                        ? 'bed'
                        : vert === 'real_estate'
                          ? 'home'
                          : 'pin',
            });
          }
        }

        if (
          productsRes.status === 'fulfilled' &&
          !productsRes.value.error &&
          Array.isArray(productsRes.value.data)
        ) {
          for (const row of productsRes.value.data as Array<Record<string, unknown>>) {
            const joined = Array.isArray(row.listings)
              ? (row.listings[0] as Record<string, unknown> | undefined)
              : (row.listings as Record<string, unknown> | undefined);
            const prodId = String(row.id || '');
            const listId = String(row.listing_id || joined?.id || '');
            if (!prodId) continue;
            const title =
              splitSamplePrefix(String(row.title || '')).title ||
              String(row.title || 'Product');
            const shopName =
              splitSamplePrefix(String(joined?.title || '')).title || 'Shop';
            const price = Math.round(Number(row.price ?? 0));
            gathered.push({
              id: `db-prod-${prodId}`,
              group: 'items',
              sectionLabel: 'Items & Food Dishes',
              title,
              subtitle: `${shopName}${joined?.locality ? ` · ${String(joined.locality)}` : ''}`,
              href: listId
                ? `/listing/${encodeURIComponent(listId)}?item=${encodeURIComponent(prodId)}`
                : `/marketplace?q=${encodeURIComponent(title)}`,
              badge: price > 0 ? `₹${price}` : undefined,
              keywords: `${title} ${shopName} ${String(row.category || '')}`,
              icon: 'shop',
            });
          }
        }

        if (
          dishesRes.status === 'fulfilled' &&
          !dishesRes.value.error &&
          Array.isArray(dishesRes.value.data)
        ) {
          for (const row of dishesRes.value.data as Array<Record<string, unknown>>) {
            const joined = Array.isArray(row.listings)
              ? (row.listings[0] as Record<string, unknown> | undefined)
              : (row.listings as Record<string, unknown> | undefined);
            const dishId = String(row.id || '');
            const listId = String(row.listing_id || joined?.id || '');
            if (!dishId || !listId) continue;
            const title =
              splitSamplePrefix(String(row.name || '')).title ||
              String(row.name || 'Dish');
            const restName =
              splitSamplePrefix(String(joined?.title || '')).title || 'Restaurant';
            const price = Math.round(Number(row.base_price_inr ?? 0));
            gathered.push({
              id: `db-dish-${dishId}`,
              group: 'items',
              sectionLabel: 'Items & Food Dishes',
              title,
              subtitle: restName,
              href: `/listing/${encodeURIComponent(listId)}?item=${encodeURIComponent(dishId)}`,
              badge: price > 0 ? `₹${price}` : undefined,
              keywords: `${title} ${restName} ${String(row.dietary_type || '')}`,
              icon: 'food',
            });
          }
        }

        if (
          civicRes.status === 'fulfilled' &&
          !civicRes.value.error &&
          Array.isArray(civicRes.value.data)
        ) {
          const needleLower = clean.toLowerCase();
          for (const row of civicRes.value.data as Array<Record<string, unknown>>) {
            const joined = Array.isArray(row.listings)
              ? (row.listings[0] as Record<string, unknown> | undefined)
              : (row.listings as Record<string, unknown> | undefined);
            if (!joined) continue;
            const listId = String(row.listing_id || joined.id || '');
            const title =
              splitSamplePrefix(String(joined.title || '')).title ||
              'Civic Service';
            const loc = String(joined.locality || activeHubName);
            const dept = String(row.department_type || 'civic');
            const helplines = Array.isArray(row.helplines)
              ? (row.helplines as Array<{ phone?: string }>)
              : [];
            const phone =
              typeof helplines[0]?.phone === 'string' ? helplines[0].phone : '';
            const hay = `${title} ${loc} ${dept} ${phone}`.toLowerCase();
            if (!hay.includes(needleLower)) continue;
            gathered.push({
              id: `db-civic-${listId}`,
              group: 'helplines',
              sectionLabel: 'Public & Emergency Helplines',
              title,
              subtitle: phone ? `${loc} • ${phone}` : loc,
              href: `/explore?civic=${encodeURIComponent(listId)}`,
              badge: row.is_24x7 ? '24×7' : dept.replace(/_/g, ' '),
              keywords: hay,
              icon: dept === 'emergency_medical' ? 'hospital' : 'civic',
            });
          }
        }

        if (
          vehiclesRes.status === 'fulfilled' &&
          !vehiclesRes.value.error &&
          Array.isArray(vehiclesRes.value.data)
        ) {
          for (const row of vehiclesRes.value.data as Array<Record<string, unknown>>) {
            const vid = String(row.id || '');
            if (!vid) continue;
            const title =
              splitSamplePrefix(String(row.title || '')).title || 'Vehicle';
            const stand = String(row.stand_locality || activeHubName);
            gathered.push({
              id: `db-veh-${vid}`,
              group: 'rides',
              sectionLabel: 'Scheduled Vehicles & Rides',
              title,
              subtitle: stand,
              href: `/vehicles/${encodeURIComponent(vid)}`,
              badge: row.booking_mode === 'per_seat' ? 'Per Seat' : 'Vehicle',
              keywords: `${title} ${stand} vehicle ride`,
              icon: 'car',
            });
          }
        }

        if (
          bulletinsRes.status === 'fulfilled' &&
          !bulletinsRes.value.error &&
          Array.isArray(bulletinsRes.value.data)
        ) {
          for (const row of bulletinsRes.value.data as Array<Record<string, unknown>>) {
            const bid = String(row.id || '');
            if (!bid) continue;
            const title =
              splitSamplePrefix(String(row.title || '')).title || 'Notice';
            const cat = String(row.category || 'notice');
            gathered.push({
              id: `db-bul-${bid}`,
              group: 'features',
              sectionLabel: 'Community Bulletins',
              title,
              subtitle: String(row.excerpt || cat),
              href: '/bulletin',
              badge: cat,
              keywords: `${title} ${String(row.excerpt || '')} ${cat}`,
              icon: 'bulletin',
            });
          }
        }

        setDbResults(gathered);
      } catch {
        if (seq === dbRequestSeqRef.current) {
          setDbResults([]);
        }
      } finally {
        if (seq === dbRequestSeqRef.current) {
          setIsDbFetching(false);
        }
      }
    }, 160);

    return () => window.clearTimeout(timer);
  }, [query, activeHubId, activeHubName]);

  // Combine & deduplicate all matching results
  const allMatchedResults = useMemo<UniversalSearchResultItem[]>(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const combined: UniversalSearchResultItem[] = [
      ...permittedWorkspaceItems,
      ...staticFeatureItems,
      ...snapshotItems,
      ...dbResults,
    ];

    const seenHrefAndTitle = new Set<string>();
    const filtered: UniversalSearchResultItem[] = [];

    for (const item of combined) {
      const hay = `${item.title} ${item.subtitle} ${item.keywords} ${item.sectionLabel}`.toLowerCase();
      if (!hay.includes(trimmed)) continue;
      const dedupeKey = `${item.href}::${item.title.toLowerCase()}`;
      if (seenHrefAndTitle.has(dedupeKey)) continue;
      seenHrefAndTitle.add(dedupeKey);
      filtered.push(item);
    }

    return filtered.slice(0, 32);
  }, [query, permittedWorkspaceItems, staticFeatureItems, snapshotItems, dbResults]);

  // Group counts for compact filter tabs
  const groupCounts = useMemo(() => {
    const counts: Record<SearchGroupTab, number> = {
      all: allMatchedResults.length,
      features: 0,
      places: 0,
      items: 0,
      helplines: 0,
      rides: 0,
      workspace: 0,
    };
    for (const r of allMatchedResults) {
      counts[r.group] += 1;
    }
    return counts;
  }, [allMatchedResults]);

  const visibleTabs = useMemo(() => {
    const populatedGroups = GROUP_TABS.filter(
      (t) => t.id !== 'all' && groupCounts[t.id] > 0
    );
    if (populatedGroups.length <= 1) return [];
    return GROUP_TABS.filter((t) => t.id === 'all' || groupCounts[t.id] > 0);
  }, [groupCounts]);

  const effectiveTab: SearchGroupTab =
    activeGroupTab !== 'all' && groupCounts[activeGroupTab] === 0
      ? 'all'
      : activeGroupTab;

  const displayedResults = useMemo(() => {
    if (effectiveTab === 'all') return allMatchedResults;
    return allMatchedResults.filter((r) => r.group === effectiveTab);
  }, [allMatchedResults, effectiveTab]);

  // Group into ordered sections for rendering
  const groupedSections = useMemo(() => {
    const map = new Map<string, UniversalSearchResultItem[]>();
    for (const item of displayedResults) {
      const existing = map.get(item.sectionLabel);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.sectionLabel, [item]);
      }
    }
    return Array.from(map.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [displayedResults]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, effectiveTab]);

  const navigateToItem = useCallback(
    (item: UniversalSearchResultItem) => {
      if (query.trim().length > 0) {
        setRecentSearches(writeRecentSearch(query));
      }
      setIsDesktopOpen(false);
      setIsMobileOverlayOpen(false);
      if (item.requiresAuth && !isAuthenticated && onOpenAuthModal) {
        onOpenAuthModal();
        return;
      }
      router.push(item.href);
    },
    [query, isAuthenticated, onOpenAuthModal, router]
  );

  const navigateToHref = useCallback(
    (href: string) => {
      setIsDesktopOpen(false);
      setIsMobileOverlayOpen(false);
      router.push(href);
    },
    [router]
  );

  const handleInputKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      setIsDesktopOpen(false);
      setIsMobileOverlayOpen(false);
      desktopInputRef.current?.blur();
      return;
    }
    if (ev.key === 'ArrowDown') {
      if (displayedResults.length === 0) return;
      ev.preventDefault();
      setIsDesktopOpen(true);
      setHighlightedIndex((idx) => (idx + 1) % displayedResults.length);
      return;
    }
    if (ev.key === 'ArrowUp') {
      if (displayedResults.length === 0) return;
      ev.preventDefault();
      setHighlightedIndex(
        (idx) => (idx - 1 + displayedResults.length) % displayedResults.length
      );
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const target =
        displayedResults[highlightedIndex] || displayedResults[0] || null;
      if (target) {
        navigateToItem(target);
      } else if (query.trim()) {
        setRecentSearches(writeRecentSearch(query));
        navigateToHref(`/explore?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const renderResultsBody = () => {
    const hasQuery = query.trim().length > 0;

    if (!hasQuery) {
      return (
        <div className="space-y-3 p-3 text-left">
          {recentSearches.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <History className="h-3 w-3" />
                  <span>Recent Searches</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearchesStorage();
                    setRecentSearches([]);
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {recentSearches.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => onQueryChange(term)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-medium text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
                  >
                    <History className="h-3 w-3 text-[var(--ps-text-muted)]" />
                    <span>{term}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="px-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Popular Quick Jumps
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {POPULAR_QUICK_JUMPS.map((jump) => (
                <button
                  key={jump.label}
                  type="button"
                  onClick={() => navigateToHref(jump.href)}
                  className="flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]">
                    <ResultGlyph kind={jump.icon} />
                  </span>
                  <span className="truncate">{jump.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="divide-y divide-[var(--ps-border)]/70 text-left">
        {/* Compact Group Filter Tabs */}
        {visibleTabs.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 no-scrollbar">
            {visibleTabs.map((tab) => {
              const active = effectiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveGroupTab(tab.id)}
                  className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="text-[10px] opacity-80 tabular-nums">
                    {groupCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Shimmering Skeleton Rows while live DB query fetches */}
        {isDbFetching && (
          <div
            data-testid="universal-search-skeleton"
            className="space-y-1.5 px-3 py-2"
          >
            {[0, 1].map((rowIdx) => (
              <div
                key={rowIdx}
                className="flex items-center gap-2.5 rounded-xl bg-[var(--ps-surface-alt)]/70 px-2.5 py-2 animate-pulse"
              >
                <div className="h-7 w-7 rounded-lg bg-[var(--ps-border)]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-2/5 rounded bg-[var(--ps-border)]" />
                  <div className="h-2 w-3/5 rounded bg-[var(--ps-border)]/70" />
                </div>
              </div>
            ))}
          </div>
        )}

        {displayedResults.length === 0 && !isDbFetching ? (
          <div className="px-4 py-5 text-center space-y-2">
            <p className="text-xs font-semibold text-[var(--ps-text-muted)]">
              No direct matches for &ldquo;{query.trim()}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => {
                setRecentSearches(writeRecentSearch(query));
                navigateToHref(
                  `/explore?q=${encodeURIComponent(query.trim())}`
                );
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 transition-opacity cursor-pointer"
            >
              <Compass className="h-3.5 w-3.5" />
              <span>Search &ldquo;{query.trim()}&rdquo; on Explore Map</span>
            </button>
          </div>
        ) : (
          groupedSections.map((section) => (
            <div key={section.label} className="p-2">
              <p className="px-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const flatIndex = displayedResults.findIndex(
                    (x) => x.id === item.id
                  );
                  const isHighlighted = flatIndex === highlightedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setHighlightedIndex(flatIndex)}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => navigateToItem(item)}
                      className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                        isHighlighted
                          ? 'bg-[var(--ps-accent)]/12 ring-1 ring-[var(--ps-accent)]/35'
                          : 'hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            isHighlighted
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]'
                          }`}
                        >
                          <ResultGlyph kind={item.icon} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-[var(--ps-text)]">
                            <HighlightedText text={item.title} query={query} />
                          </div>
                          {item.subtitle && (
                            <div className="truncate text-[10px] text-[var(--ps-text-muted)]">
                              <HighlightedText
                                text={item.subtitle}
                                query={query}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.badge && (
                          <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-text)] capitalize">
                            {item.badge}
                          </span>
                        )}
                        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <>
      <div
        ref={containerRef}
        role="search"
        data-tour="home-hero-search"
        data-testid="universal-app-search"
        className="relative mx-auto w-full max-w-2xl"
      >
        {/* Zero-Submit Search Bar Trigger */}
        <div
          onClick={() => {
            if (typeof window !== 'undefined' && window.innerWidth < 640) {
              setIsMobileOverlayOpen(true);
            } else {
              desktopInputRef.current?.focus();
              setIsDesktopOpen(true);
            }
          }}
          className="flex h-12 w-full items-center gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 px-3.5 shadow-lg shadow-slate-900/5 backdrop-blur-md transition-all focus-within:border-[var(--ps-accent)] focus-within:ring-2 focus-within:ring-[var(--ps-accent)]/25"
        >
          {isDbFetching ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-[var(--ps-accent)]"
              aria-hidden="true"
            />
          ) : (
            <Search
              className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]"
              aria-hidden="true"
            />
          )}

          <input
            ref={desktopInputRef}
            type="search"
            value={query}
            onFocus={() => {
              if (typeof window !== 'undefined' && window.innerWidth < 640) {
                desktopInputRef.current?.blur();
                setIsMobileOverlayOpen(true);
              } else {
                setIsDesktopOpen(true);
              }
            }}
            onChange={(e) => {
              onQueryChange(e.target.value);
              if (typeof window !== 'undefined' && window.innerWidth >= 640) {
                setIsDesktopOpen(true);
              }
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            data-testid="landing-hero-search-input"
            className="h-full w-full flex-1 bg-transparent text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />

          {query.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQueryChange('');
                desktopInputRef.current?.focus();
              }}
              aria-label="Clear search query"
              data-testid="universal-search-clear-btn"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="hidden sm:inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1.5 font-mono text-[10px] font-bold text-[var(--ps-text-muted)]"
            >
              ⌘K
            </kbd>
          )}
        </div>

        {/* Tablet & Desktop Floating Results Dropdown (z-[75]) */}
        <AnimatePresence>
          {isDesktopOpen && (
            <motion.div
              data-testid="universal-search-dropdown-desktop"
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="hidden sm:block absolute left-0 right-0 top-[calc(100%+8px)] z-[75] max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 backdrop-blur-xl shadow-2xl"
            >
              {renderResultsBody()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Keyboard-Safe VisualViewport Overlay (z-[88]) */}
      {isMobileOverlayOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="universal-search-mobile-overlay"
            style={{ height: `${visualViewportHeight}px` }}
            className="fixed inset-x-0 top-0 z-[88] flex flex-col bg-[var(--ps-bg)]/98 backdrop-blur-xl sm:hidden"
          >
            <div className="flex items-center gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsMobileOverlayOpen(false)}
                aria-label="Close search"
                data-testid="universal-search-mobile-back"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

              <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 focus-within:border-[var(--ps-accent)]">
                {isDbFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--ps-accent)]" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
                )}
                <input
                  ref={mobileInputRef}
                  type="search"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={placeholder}
                  aria-label={placeholder}
                  className="h-full w-full flex-1 bg-transparent text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onQueryChange('');
                      mobileInputRef.current?.focus();
                    }}
                    aria-label="Clear search query"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ps-text-muted)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain bg-[var(--ps-surface)]">
              {renderResultsBody()}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default UniversalAppSearch;
