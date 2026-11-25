'use client';

export type AppAnalyticsEventType =
  | 'page_view'
  | 'listing_click'
  | 'shortcut_click'
  | 'search_query'
  | 'whatsapp_click'
  | 'enquiry_submit'
  | 'pnd_quote'
  | 'booking_create'
  | 'escrow_verified'
  | 'bulletin_view';

export interface TrackAppEventPayload {
  event_type: AppAnalyticsEventType;
  feature_area?: string;
  target_id?: string;
  root_key?: string;
  locality?: string;
}

const TELEMETRY_SESSION_KEY = 'ddoodle_telemetry_sid_v1';

function getOrCreateAnonymousSessionToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const existing = window.sessionStorage.getItem(TELEMETRY_SESSION_KEY);
    if (existing && existing.length >= 12) return existing;
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    window.sessionStorage.setItem(TELEMETRY_SESSION_KEY, token);
    return token;
  } catch {
    return undefined;
  }
}

function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  const width = window.innerWidth || 0;
  if (width <= 0) return 'unknown';
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function inferFeatureAreaFromPath(pathname: string): string {
  const clean = (pathname || '/').toLowerCase();
  if (clean === '/' || clean === '') return 'home';
  if (clean.startsWith('/explore')) return 'explore';
  if (clean.startsWith('/pick-n-drop') || clean.startsWith('/logistics')) return 'pick_n_drop';
  if (clean.startsWith('/vehicles')) return 'vehicles';
  if (clean.startsWith('/marketplace')) return 'marketplace';
  if (clean.startsWith('/bulletin')) return 'bulletin';
  if (clean.startsWith('/civic')) return 'civic';
  if (clean.startsWith('/listing')) return 'listings';
  if (clean.startsWith('/saved')) return 'saved';
  if (clean.startsWith('/workspace')) return 'workspace';
  if (clean.startsWith('/admin')) return 'admin';
  return 'other';
}

/**
 * Non-blocking, privacy-safe event tracker using `navigator.sendBeacon`
 * with `fetch(..., { keepalive: true })` fallback.
 */
export function trackAppEvent(payload: TrackAppEventPayload): void {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({
      event_type: payload.event_type,
      feature_area: payload.feature_area?.slice(0, 48),
      target_id: payload.target_id?.slice(0, 120),
      root_key: payload.root_key?.slice(0, 48),
      locality: payload.locality?.slice(0, 80),
      session_hash: getOrCreateAnonymousSessionToken(),
      device_type: detectDeviceType(),
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      const queued = navigator.sendBeacon('/api/telemetry/track', blob);
      if (queued) return;
    }

    void fetch('/api/telemetry/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Telemetry failures must never impact user experience
    });
  } catch {
    // Ignore telemetry errors silently
  }
}
