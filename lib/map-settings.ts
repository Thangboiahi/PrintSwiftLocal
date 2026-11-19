export interface MapSettings {
  lat: number;
  lng: number;
  zoom: number;
  configured?: boolean;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  lat: 24.3335,
  lng: 93.6978,
  zoom: 13,
  configured: false,
};

export const MAP_SETTINGS_COOKIE_NAME = 'ps_map_settings';
export const STORAGE_KEY_MAP_PROMPT_DISMISSED =
  'printswift_local_map_settings_prompt_dismissed_v1';

export function parseMapSettings(raw: unknown): MapSettings | null {
  if (!raw) return null;
  let candidate = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  const obj = candidate as Record<string, unknown>;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  const rawZoom = obj.zoom !== undefined ? Number(obj.zoom) : 13;

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

  const zoom = Number.isFinite(rawZoom)
    ? Math.min(20, Math.max(3, Math.round(rawZoom)))
    : 13;

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    zoom,
    configured: Boolean(obj.configured ?? true),
  };
}
