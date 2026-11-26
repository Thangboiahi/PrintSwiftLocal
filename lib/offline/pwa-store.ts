'use client';

/**
 * Lightweight IndexedDB Offline Store (`lib/offline/pwa-store.ts`)
 *
 * Maintains strictly TWO bounded namespaces for rural Churachandpur offline resilience:
 *   1. `civic_emergency_cache`: Verified 24x7 hospitals, police, fire & govt helplines
 *      captured whenever `/civic` loads online, tagged with `syncedAt`.
 *   2. `customer_active_otps`: ONLY the logged-in customer's own active Pick N Drop
 *      or Vehicle booking OTPs & trip summaries — strictly keyed by `user_id`, purged
 *      immediately on sign-out or trip completion, and NEVER read by Driver/Mediator UIs.
 */

const DB_NAME = 'ddoodle_offline_pwa_v1';
const DB_VERSION = 1;
const CIVIC_STORE = 'civic_emergency_cache';
const CUSTOMER_OTPS_STORE = 'customer_active_otps';

const CIVIC_RECORD_KEY = 'churachandpur_civic_v1';

export interface OfflineCivicHelpline {
  label: string;
  phone: string;
  is_emergency?: boolean;
}

export interface OfflineCivicRecord {
  id: string;
  hub_id?: string | null;
  title: string;
  locality: string;
  address: string;
  department_type: string;
  is_24x7: boolean;
  office_hours_text: string | null;
  contact_phone: string;
  short_description: string;
  helplines: OfflineCivicHelpline[];
  live_civic_alert: string | null;
  lat: number;
  lng: number;
}

export interface CachedCivicDirectorySnapshot {
  key: string;
  hubId: string;
  hubName: string;
  syncedAt: string;
  items: OfflineCivicRecord[];
}

export interface OfflineCustomerOtpItem {
  id: string;
  kind: 'pick_n_drop' | 'vehicle_booking';
  code: string;
  title: string;
  status: string;
  pickupLabel: string;
  dropoffLabel: string | null;
  pickupOtp: string | null;
  dropoffOtp: string | null;
  returnOtp: string | null;
  startOtp: string | null;
  endOtp: string | null;
  updatedAt: string;
}

export interface CachedCustomerOtpsRecord {
  userId: string;
  syncedAt: string;
  items: OfflineCustomerOtpItem[];
}

const COMPLETED_STATUSES = new Set([
  'completed',
  'cancelled',
  'canceled',
  'expired',
  'refunded',
]);

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CIVIC_STORE)) {
          db.createObjectStore(CIVIC_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(CUSTOMER_OTPS_STORE)) {
          db.createObjectStore(CUSTOMER_OTPS_STORE, { keyPath: 'userId' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// =============================================================================
// 1. Civic Emergency Directory Cache
// =============================================================================

export async function saveCivicEmergencyCache(params: {
  hubId: string;
  hubName: string;
  items: OfflineCivicRecord[];
}): Promise<string | null> {
  const db = await openOfflineDb();
  if (!db) return null;

  const syncedAt = new Date().toISOString();
  const snapshot: CachedCivicDirectorySnapshot = {
    key: CIVIC_RECORD_KEY,
    hubId: params.hubId || 'churachandpur',
    hubName: params.hubName || 'Churachandpur',
    syncedAt,
    items: params.items.slice(0, 120),
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CIVIC_STORE, 'readwrite');
      tx.objectStore(CIVIC_STORE).put(snapshot);
      tx.oncomplete = () => {
        db.close();
        resolve(syncedAt);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function loadCivicEmergencyCache(): Promise<CachedCivicDirectorySnapshot | null> {
  const db = await openOfflineDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CIVIC_STORE, 'readonly');
      const req = tx.objectStore(CIVIC_STORE).get(CIVIC_RECORD_KEY);
      req.onsuccess = () => {
        const result = req.result as CachedCivicDirectorySnapshot | undefined;
        db.close();
        resolve(result || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

// =============================================================================
// 2. Customer-Only Active Booking OTPs Cache (Strictly keyed by userId)
// =============================================================================

export async function syncCustomerActiveOtpsCache(
  userId: string,
  items: OfflineCustomerOtpItem[],
  kindFilter?: 'pick_n_drop' | 'vehicle_booking'
): Promise<string | null> {
  if (!userId) return null;
  const db = await openOfflineDb();
  if (!db) return null;

  // Filter out any completed/cancelled trips automatically so stale OTPs are purged
  const activeIncoming = items.filter(
    (item) => !COMPLETED_STATUSES.has(String(item.status || '').toLowerCase())
  );

  const existing = await loadCustomerActiveOtpsCache(userId);
  const retainedOtherKinds = kindFilter && existing?.items
    ? existing.items.filter(
        (item) =>
          item.kind !== kindFilter &&
          !COMPLETED_STATUSES.has(String(item.status || '').toLowerCase())
      )
    : [];

  const merged = [...activeIncoming, ...retainedOtherKinds].slice(0, 20);
  const syncedAt = new Date().toISOString();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CUSTOMER_OTPS_STORE, 'readwrite');
      const store = tx.objectStore(CUSTOMER_OTPS_STORE);
      if (merged.length === 0) {
        store.delete(userId);
      } else {
        const payload: CachedCustomerOtpsRecord = {
          userId,
          syncedAt,
          items: merged,
        };
        store.put(payload);
      }
      tx.oncomplete = () => {
        db.close();
        resolve(syncedAt);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function loadCustomerActiveOtpsCache(
  userId: string
): Promise<CachedCustomerOtpsRecord | null> {
  if (!userId) return null;
  const db = await openOfflineDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CUSTOMER_OTPS_STORE, 'readonly');
      const req = tx.objectStore(CUSTOMER_OTPS_STORE).get(userId);
      req.onsuccess = () => {
        const result = req.result as CachedCustomerOtpsRecord | undefined;
        db.close();
        if (!result) {
          resolve(null);
          return;
        }
        const activeItems = (result.items || []).filter(
          (item) =>
            !COMPLETED_STATUSES.has(String(item.status || '').toLowerCase())
        );
        resolve({
          ...result,
          items: activeItems,
        });
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/**
 * Purges private customer offline OTP cache immediately (called on Sign Out).
 * When `userId` is omitted, wipes all records in `customer_active_otps`.
 */
export async function purgeCustomerOfflineOtps(userId?: string | null): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CUSTOMER_OTPS_STORE, 'readwrite');
      const store = tx.objectStore(CUSTOMER_OTPS_STORE);
      if (userId) {
        store.delete(userId);
      } else {
        store.clear();
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export function formatOfflineSyncTime(iso: string | null | undefined): string {
  if (!iso) return 'Just now';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Recently';
  return dt.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}
