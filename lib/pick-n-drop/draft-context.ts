'use client';

import { useCallback, useEffect, useState } from 'react';
import { calculateDistanceMeters } from '@/lib/rules';
import {
  LAMKA_QUICK_LANDMARKS,
  type DeliveryServiceMode,
  type DeliveryTripType,
  type PickNDropPoint,
} from '@/lib/pick-n-drop/types';

export const PICK_N_DROP_DRAFT_STORAGE_KEY = 'ddoodle_pick_n_drop_draft_v1';

export interface PickNDropDraftPoint extends PickNDropPoint {
  listingId?: string;
}

export interface CustomMapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  createdAt: number;
}

export interface PickNDropDraftState {
  serviceType: DeliveryServiceMode;
  tripMode: DeliveryTripType;
  vehicleTypeSlug: string | null;
  pickup: PickNDropDraftPoint | null;
  dropoff: PickNDropDraftPoint | null;
  activePinTarget: 'pickup' | 'dropoff' | null;
  customMarkers: CustomMapMarker[];
  updatedAt: number;
}

export const DEFAULT_PICK_N_DROP_DRAFT: PickNDropDraftState = {
  serviceType: 'parcel',
  tripMode: 'one_way',
  vehicleTypeSlug: null,
  pickup: null,
  dropoff: null,
  activePinTarget: null,
  customMarkers: [],
  updatedAt: 0,
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  });
}

function sanitizePoint(raw: unknown): PickNDropDraftPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  const label =
    typeof obj.label === 'string' && obj.label.trim().length > 0
      ? obj.label.trim()
      : `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  const listingId =
    typeof obj.listingId === 'string' && obj.listingId.trim().length > 0
      ? obj.listingId.trim()
      : undefined;
  return listingId ? { lat, lng, label, listingId } : { lat, lng, label };
}

function sanitizeCustomMarkers(raw: unknown): CustomMapMarker[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomMapMarker[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const lat = Number(rec.lat);
    const lng = Number(rec.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id =
      typeof rec.id === 'string' && rec.id.trim().length > 0
        ? rec.id.trim()
        : `cm-${Math.round(lat * 10000)}-${Math.round(lng * 10000)}`;
    const label =
      typeof rec.label === 'string' && rec.label.trim().length > 0
        ? rec.label.trim()
        : `Marked Point (${lat.toFixed(4)}°, ${lng.toFixed(4)}°)`;
    const createdAt =
      typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt)
        ? rec.createdAt
        : Date.now();
    out.push({ id, lat, lng, label, createdAt });
  }
  return out.slice(0, 25);
}

export function readPickNDropDraft(): PickNDropDraftState {
  if (typeof window === 'undefined') return DEFAULT_PICK_N_DROP_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(PICK_N_DROP_DRAFT_STORAGE_KEY);
    if (!raw) return DEFAULT_PICK_N_DROP_DRAFT;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const serviceType: DeliveryServiceMode =
      parsed.serviceType === 'passenger' || parsed.serviceType === 'gas'
        ? parsed.serviceType
        : 'parcel';
    const tripMode: DeliveryTripType =
      parsed.tripMode === 'two_way' ? 'two_way' : 'one_way';
    const vehicleTypeSlug =
      typeof parsed.vehicleTypeSlug === 'string' &&
      parsed.vehicleTypeSlug.trim().length > 0
        ? parsed.vehicleTypeSlug.trim()
        : null;
    const activePinTarget =
      parsed.activePinTarget === 'pickup' ||
      parsed.activePinTarget === 'dropoff'
        ? parsed.activePinTarget
        : null;

    return {
      serviceType,
      tripMode,
      vehicleTypeSlug,
      pickup: sanitizePoint(parsed.pickup),
      dropoff: sanitizePoint(parsed.dropoff),
      activePinTarget,
      customMarkers: sanitizeCustomMarkers(parsed.customMarkers),
      updatedAt:
        typeof parsed.updatedAt === 'number' &&
        Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
    };
  } catch {
    return DEFAULT_PICK_N_DROP_DRAFT;
  }
}

export function writePickNDropDraft(
  next: PickNDropDraftState
): PickNDropDraftState {
  const stamped: PickNDropDraftState = {
    ...next,
    updatedAt: Date.now(),
  };
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(
        PICK_N_DROP_DRAFT_STORAGE_KEY,
        JSON.stringify(stamped)
      );
    } catch {
      // Ignore storage quota / private mode failures
    }
  }
  notifyListeners();
  return stamped;
}

export function patchPickNDropDraft(
  partial: Partial<PickNDropDraftState>
): PickNDropDraftState {
  const current = readPickNDropDraft();
  return writePickNDropDraft({
    ...current,
    ...partial,
  });
}

export function clearPickNDropDraft(): PickNDropDraftState {
  const current = readPickNDropDraft();
  return writePickNDropDraft({
    ...DEFAULT_PICK_N_DROP_DRAFT,
    customMarkers: current.customMarkers,
  });
}

export function subscribePickNDropDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePickNDropDraft() {
  const [draft, setDraft] = useState<PickNDropDraftState>(() =>
    readPickNDropDraft()
  );

  useEffect(() => {
    setDraft(readPickNDropDraft());
    const unsub = subscribePickNDropDraft(() => {
      setDraft(readPickNDropDraft());
    });
    const handleStorage = (ev: StorageEvent) => {
      if (ev.key === PICK_N_DROP_DRAFT_STORAGE_KEY) {
        setDraft(readPickNDropDraft());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      unsub();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const updateDraft = useCallback((partial: Partial<PickNDropDraftState>) => {
    return patchPickNDropDraft(partial);
  }, []);

  return {
    draft,
    updateDraft,
    clearDraft: clearPickNDropDraft,
  };
}

export function buildExplorePickNDropUrl(
  hubSlug: string,
  draft: PickNDropDraftState,
  pinTarget?: 'pickup' | 'dropoff' | null
): string {
  const params = new URLSearchParams();
  if (hubSlug) params.set('hub', hubSlug);
  params.set('mode', 'pick_n_drop');
  if (pinTarget) params.set('pinTarget', pinTarget);
  if (draft.serviceType && draft.serviceType !== 'parcel') {
    params.set('serviceType', draft.serviceType);
  }
  if (draft.tripMode === 'two_way') {
    params.set('tripMode', 'two_way');
  }
  if (draft.vehicleTypeSlug) {
    params.set('vehicle', draft.vehicleTypeSlug);
  }
  if (draft.pickup) {
    params.set('pickupLat', draft.pickup.lat.toFixed(6));
    params.set('pickupLng', draft.pickup.lng.toFixed(6));
    params.set('pickupLabel', draft.pickup.label);
  }
  if (draft.dropoff) {
    params.set('dropoffLat', draft.dropoff.lat.toFixed(6));
    params.set('dropoffLng', draft.dropoff.lng.toFixed(6));
    params.set('dropoffLabel', draft.dropoff.label);
  }
  return `/explore?${params.toString()}`;
}

export interface LocalityCandidate {
  display_name: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Resolves a human-friendly locality label for a dropped map coordinate.
 * Uses hub localities + Lamka landmarks first for instant offline/fast naming,
 * then optionally refines via Google Maps Geocoder when available.
 */
export function resolveInstantCoordinateLabel(
  lat: number,
  lng: number,
  hubLocalities: LocalityCandidate[] = []
): string {
  const coordFallback = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  let nearestName: string | null = null;
  let nearestMeters = Infinity;

  const checkPoint = (name: string, pLat: number, pLng: number) => {
    if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return;
    const d = calculateDistanceMeters({ lat, lng }, { lat: pLat, lng: pLng });
    if (d < nearestMeters) {
      nearestMeters = d;
      nearestName = name;
    }
  };

  for (const loc of hubLocalities) {
    if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      checkPoint(loc.display_name, loc.lat, loc.lng);
    }
  }
  for (const lm of LAMKA_QUICK_LANDMARKS) {
    checkPoint(lm.label, lm.lat, lm.lng);
  }

  if (nearestName && nearestMeters <= 900) {
    return `Near ${nearestName}`;
  }
  return `Pinned (${coordFallback})`;
}

export async function resolveCoordinateLocalityAsync(
  lat: number,
  lng: number,
  hubLocalities: LocalityCandidate[] = []
): Promise<string> {
  const instant = resolveInstantCoordinateLabel(lat, lng, hubLocalities);
  if (typeof google === 'undefined' || !google.maps?.Geocoder) {
    return instant;
  }

  try {
    const geocoder = new google.maps.Geocoder();
    const label = await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 1600);
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        window.clearTimeout(timer);
        if (status === 'OK' && Array.isArray(results) && results.length > 0) {
          const best = results[0];
          const comp =
            best.address_components?.find(
              (c) =>
                c.types.includes('sublocality') ||
                c.types.includes('neighborhood') ||
                c.types.includes('route')
            )?.long_name ||
            best.formatted_address?.split(',').slice(0, 2).join(', ');
          resolve(comp ? comp.trim() : null);
        } else {
          resolve(null);
        }
      });
    });
    return label || instant;
  } catch {
    return instant;
  }
}
