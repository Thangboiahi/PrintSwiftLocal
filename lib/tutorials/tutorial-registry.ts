/**
 * First-Time Interactive Tutorials Registry & Storage Engine (Pass V6-B)
 *
 * Manages 5 guided 3–4 step page walkthroughs with:
 *  - Per-tour completion tracking (`dd_tutorials_completed`)
 *  - Permanent global opt-out (`dd_tutorials_disabled_permanently`)
 *  - Session-only temporary skip (`dd_tutorials_session_skipped`)
 *  - Synced reset with Pick N Drop crosshair picker guide (`dd_pnd_picker_tips_hidden`)
 */

export type TutorialTourId =
  | 'home'
  | 'explore'
  | 'bookings'
  | 'pick_n_drop'
  | 'activity'
  | 'workspace';

export interface TutorialStep {
  id: string;
  /** CSS selector targeting a `data-tour="..."` element on the page */
  targetSelector: string;
  title: string;
  description: string;
}

export interface TutorialTourDefinition {
  id: TutorialTourId;
  label: string;
  matchPath: (pathname: string, search?: string) => boolean;
  steps: TutorialStep[];
}

export const STORAGE_KEY_TUTORIALS_COMPLETED = 'dd_tutorials_completed';
export const STORAGE_KEY_TUTORIALS_DISABLED =
  'dd_tutorials_disabled_permanently';
export const SESSION_KEY_TUTORIALS_SKIPPED = 'dd_tutorials_session_skipped';
export const STORAGE_KEY_PND_PICKER_TIPS_HIDDEN = 'dd_pnd_picker_tips_hidden';
export const TUTORIALS_STATE_CHANGED_EVENT = 'dd:tutorials-state-changed';

export const TUTORIAL_TOURS: TutorialTourDefinition[] = [
  {
    id: 'home',
    label: 'Home Launchpad',
    matchPath: (pathname) => pathname === '/',
    steps: [
      {
        id: 'home-hub',
        targetSelector: '[data-tour="home-hub-switcher"]',
        title: 'Switch Your Local Hub',
        description:
          'Tap the DD oodle emblem or hub selector anytime to jump between Churachandpur, Aizawl, and other active hubs.',
      },
      {
        id: 'home-search',
        targetSelector: '[data-tour="home-hero-search"]',
        title: 'Universal Instant Command Search',
        description:
          'Type anytime (or press ⌘K) to search features, places, items, dishes, helplines, rides, settings, and permitted workspace shortcuts live.',
      },
      {
        id: 'home-launcher',
        targetSelector: '[data-tour="home-service-launcher"]',
        title: '16-Tile Service & Shortcut Deck',
        description:
          'Filter by Daily & Orders, Explore & Book, Mobility & Civic, or Community & Earn—or tap Quick Jump chips with pre-applied filters.',
      },
      {
        id: 'home-menu',
        targetSelector: '[data-tour="home-nav-menu"]',
        title: 'Live Nav Badges & Menu',
        description:
          'Track live active orders, alerts, Invite & Referrals, and your operational Workspaces right from the top menu.',
      },
    ],
  },
  {
    id: 'explore',
    label: 'Explore Map',
    matchPath: (pathname) => pathname.startsWith('/explore'),
    steps: [
      {
        id: 'explore-categories',
        targetSelector: '[data-tour="explore-categories"]',
        title: 'Collapsible Smart Categories',
        description:
          'Tap any category pill to filter pins or browse subcategories while keeping the map spacious and clean.',
      },
      {
        id: 'explore-pins',
        targetSelector: '[data-tour="explore-map-canvas"]',
        title: 'Smart Pins & Zoom-to-Plot Polygons',
        description:
          'Tap logo/feature pins for previews, zoom past level 16 on Real Estate properties to morph pins into exact plot boundaries with Area + Price, or long-press anywhere on the map.',
      },
      {
        id: 'explore-pnd',
        targetSelector: '[data-tour="explore-pnd-handle"]',
        title: 'Unified Route, Directions & Pick N Drop Studio',
        description:
          'Open the unified Journey Studio to pick Point A & B, view live road Directions & ETA, and switch seamlessly to Pick N Drop booking in one tap.',
      },
      {
        id: 'explore-toolbox',
        targetSelector: '[data-tour="explore-toolbox"]',
        title: 'Map Presets & Toolbox',
        description:
          'Switch between Everyday Discovery, Clean & Simple, Property & Plots, and Pro Measure & Survey presets or toggle map layer tools.',
      },
    ],
  },
  {
    id: 'bookings',
    label: 'Scheduled Bookings Hub',
    matchPath: (pathname) =>
      pathname.startsWith('/bookings') || pathname.startsWith('/vehicles'),
    steps: [
      {
        id: 'bookings-tabs',
        targetSelector: '[data-tour="bookings-tabs"]',
        title: 'All Scheduled Bookings in One Hub',
        description:
          'Swipe seamlessly across Inter-Hub Bus & Vehicles, Turfs & Halls, Hotels & Stays, Upcoming Events, and Table Reservations.',
      },
      {
        id: 'bookings-filters',
        targetSelector: '[data-tour="bookings-filters"]',
        title: 'Quick Date, Locality & Price Filters',
        description:
          'Filter by Today, Tomorrow, This Weekend, or route & locality to pinpoint available departures and open slots fast.',
      },
      {
        id: 'bookings-cards',
        targetSelector: '[data-tour="bookings-cards"]',
        title: 'Instant Booking, Map Pin & Dropoff Sync',
        description:
          'Reserve seats or slots directly, locate any venue on the map, or drop its coordinates straight into Pick N Drop.',
      },
    ],
  },
  {
    id: 'pick_n_drop',
    label: 'Pick N Drop',
    matchPath: (pathname, search = '') => {
      const cleanPath = (pathname || '/').split('?')[0] || '/';
      if (cleanPath.startsWith('/pick-n-drop')) return true;
      if (cleanPath.startsWith('/explore')) {
        return new URLSearchParams(search).get('mode') === 'pick_n_drop';
      }
      return false;
    },
    steps: [
      {
        id: 'pnd-mode',
        targetSelector: '[data-tour="pnd-service-mode"]',
        title: 'Choose Your Service Type',
        description:
          'Pick Parcel delivery, a quick Passenger Ride, or LPG Cylinder Exchange—fares calculate live by route distance.',
      },
      {
        id: 'pnd-picker',
        targetSelector: '[data-tour="pnd-map-picker"]',
        title: 'Unified Map Journey & Crosshair Picker',
        description:
          'Tap "Pin on Map" inside /explore?mode=pick_n_drop—center the crosshair or tap any listing to lock Pickup (A) & Dropoff (B) with live road route distance and ETA.',
      },
      {
        id: 'pnd-otps',
        targetSelector: '[data-tour="pnd-otp-info"]',
        title: 'Secure Sender & Recipient OTPs',
        description:
          'Every dispatch generates separate Pickup and Dropoff OTPs so handovers stay safe and verifiable.',
      },
    ],
  },
  {
    id: 'activity',
    label: 'Activity & Ledger',
    matchPath: (pathname) => pathname.startsWith('/activity'),
    steps: [
      {
        id: 'activity-tabs',
        targetSelector: '[data-tour="activity-tabs"]',
        title: 'Live Order & Booking Tabs',
        description:
          'Switch between Pick N Drop, Vehicle & Venue Bookings, Food & Shop Orders, Print Jobs, and Payment Receipts.',
      },
      {
        id: 'activity-otp',
        targetSelector: '[data-tour="activity-share-otp"]',
        title: 'One-Tap Share Dropoff OTP',
        description:
          'Send the recipient their Dropoff OTP via WhatsApp or your phone’s native share sheet in one tap.',
      },
      {
        id: 'activity-tracker',
        targetSelector: '[data-tour="activity-tracker"]',
        title: 'Receipts & Full Tracking',
        description:
          'Open any card for real-time status milestones, driver details, and verifiable payment UTR records.',
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspaces',
    matchPath: (pathname) => pathname.startsWith('/workspace'),
    steps: [
      {
        id: 'ws-hats',
        targetSelector: '[data-tour="workspace-hat-switcher"]',
        title: 'Operational Hat Switcher',
        description:
          'Switch cleanly between your Owner, Staff Desk, Driver Console, Hub Manager, or Master Control hats.',
      },
      {
        id: 'ws-business',
        targetSelector: '[data-tour="workspace-business-selector"]',
        title: 'Active Business Selector',
        description:
          'Select which business or storefront you are operating to manage live orders, slots, and catalogues.',
      },
      {
        id: 'ws-quotas',
        targetSelector: '[data-tour="workspace-quota-meters"]',
        title: 'Entitlement Quota Meters',
        description:
          'Keep track of active plans, remaining listing/post quotas, and hub verification checklists in one place.',
      },
    ],
  },
];

function notifyTutorialChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(TUTORIALS_STATE_CHANGED_EVENT));
  } catch {
    // Ignore event dispatch failures
  }
}

export function resolveTourForPath(
  pathname: string,
  search = ''
): TutorialTourDefinition | null {
  const cleanPath = (pathname || '/').split('?')[0] || '/';
  const rawSearch =
    search || (pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : '');
  // Prioritize pick_n_drop walkthrough when /explore?mode=pick_n_drop is active
  if (
    cleanPath.startsWith('/explore') &&
    new URLSearchParams(rawSearch).get('mode') === 'pick_n_drop'
  ) {
    return TUTORIAL_TOURS.find((t) => t.id === 'pick_n_drop') || null;
  }
  return TUTORIAL_TOURS.find((t) => t.matchPath(cleanPath, rawSearch)) || null;
}

export function readCompletedTutorials(): TutorialTourId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_TUTORIALS_COMPLETED);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is TutorialTourId =>
        typeof id === 'string' &&
        TUTORIAL_TOURS.some((tour) => tour.id === id)
    );
  } catch {
    return [];
  }
}

export function markTutorialCompleted(tourId: TutorialTourId): void {
  if (typeof window === 'undefined') return;
  try {
    const current = new Set(readCompletedTutorials());
    current.add(tourId);
    window.localStorage.setItem(
      STORAGE_KEY_TUTORIALS_COMPLETED,
      JSON.stringify(Array.from(current))
    );
    notifyTutorialChange();
  } catch {
    // Ignore storage errors
  }
}

export function readTutorialsDisabledPermanently(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(STORAGE_KEY_TUTORIALS_DISABLED) === 'true'
    );
  } catch {
    return false;
  }
}

export function writeTutorialsDisabledPermanently(disabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (disabled) {
      window.localStorage.setItem(STORAGE_KEY_TUTORIALS_DISABLED, 'true');
    } else {
      window.localStorage.removeItem(STORAGE_KEY_TUTORIALS_DISABLED);
    }
    notifyTutorialChange();
  } catch {
    // Ignore storage errors
  }
}

export function readSessionSkippedTutorials(): TutorialTourId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY_TUTORIALS_SKIPPED);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is TutorialTourId =>
        typeof id === 'string' &&
        TUTORIAL_TOURS.some((tour) => tour.id === id)
    );
  } catch {
    return [];
  }
}

export function markTutorialSkippedForSession(tourId: TutorialTourId): void {
  if (typeof window === 'undefined') return;
  try {
    const current = new Set(readSessionSkippedTutorials());
    current.add(tourId);
    window.sessionStorage.setItem(
      SESSION_KEY_TUTORIALS_SKIPPED,
      JSON.stringify(Array.from(current))
    );
    notifyTutorialChange();
  } catch {
    // Ignore storage errors
  }
}

export function shouldAutoStartTour(tourId: TutorialTourId): boolean {
  if (readTutorialsDisabledPermanently()) return false;
  if (readCompletedTutorials().includes(tourId)) return false;
  if (readSessionSkippedTutorials().includes(tourId)) return false;
  return true;
}

export function resetAllTutorials(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_TUTORIALS_COMPLETED);
    window.localStorage.removeItem(STORAGE_KEY_TUTORIALS_DISABLED);
    window.localStorage.removeItem(STORAGE_KEY_PND_PICKER_TIPS_HIDDEN);
    window.sessionStorage.removeItem(SESSION_KEY_TUTORIALS_SKIPPED);
    notifyTutorialChange();
  } catch {
    // Ignore storage errors
  }
}
