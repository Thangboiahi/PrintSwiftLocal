import { MapAppearanceVariant, MapStyleOption } from './types';

export interface CloudMapFeatureGeometry {
  fillColor?: string;
  strokeColor?: string;
  strokeWeight?: number;
}

export interface CloudMapFeatureLabel {
  pinFillColor?: string;
  pinGlyphColor?: string;
  pinOutlineColor?: string;
  textFillColor?: string;
  textStrokeColor?: string;
}

export interface CloudMapStyleRule {
  id: string;
  geometry?: CloudMapFeatureGeometry;
  label?: CloudMapFeatureLabel;
}

export interface PrintSwiftCloudMapStyleSpec {
  variant: MapAppearanceVariant;
  backgroundColor: string;
  metadata: {
    name: string;
    description: string;
    version: string;
  };
  styles: CloudMapStyleRule[];
}

export const PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE: PrintSwiftCloudMapStyleSpec = {
  variant: 'light',
  backgroundColor: '#F7F8F6',
  metadata: {
    name: 'PrintSwift Neutral Discovery',
    description: 'Clean, minimalist map styling for local discovery.',
    version: '1.0',
  },
  styles: [
    {
      id: 'natural.land',
      geometry: {
        fillColor: '#F4F6F2',
      },
    },
    {
      id: 'natural.base',
      geometry: {
        fillColor: '#F4F6F2',
      },
    },
    {
      id: 'natural.water',
      geometry: {
        fillColor: '#DCEAF0',
        strokeColor: '#C8DDE6',
        strokeWeight: 1,
      },
      label: {
        textFillColor: '#5B7885',
        textStrokeColor: '#EAF2F5',
      },
    },
    {
      id: 'natural.land.landCover.forest',
      geometry: {
        fillColor: '#E1EBDD',
      },
    },
    {
      id: 'infrastructure.building',
      geometry: {
        fillColor: '#E8EAE5',
        strokeColor: '#DEE2DB',
        strokeWeight: 0.5,
      },
    },
    {
      id: 'infrastructure.building.commercial',
      geometry: {
        fillColor: '#E5E8E2',
        strokeColor: '#D9DED6',
        strokeWeight: 0.6,
      },
    },
    {
      id: 'infrastructure.roadNetwork.road',
      geometry: {
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
      },
      label: {
        textFillColor: '#68716C',
        textStrokeColor: '#F7F8F6',
      },
    },
    {
      id: 'infrastructure.roadNetwork.road.local',
      geometry: {
        strokeColor: '#FFFFFF',
        strokeWeight: 1.5,
      },
    },
    {
      id: 'infrastructure.roadNetwork.road.arterial',
      geometry: {
        strokeColor: '#F1D5B6',
        strokeWeight: 2.5,
      },
    },
    {
      id: 'infrastructure.roadNetwork.road.highway',
      geometry: {
        strokeColor: '#E7C39A',
        strokeWeight: 3.2,
      },
    },
    {
      id: 'infrastructure.roadNetwork.noTraffic.trail',
      geometry: {
        strokeColor: '#B8C9AE',
        strokeWeight: 1.3,
      },
    },
    {
      id: 'infrastructure.railwayTrack',
      geometry: {
        strokeColor: '#C5C9C2',
        strokeWeight: 1.2,
      },
    },
    {
      id: 'infrastructure.transitStation',
      label: {
        pinFillColor: '#8A9690',
        pinGlyphColor: '#FFFFFF',
        textFillColor: '#66716B',
        textStrokeColor: '#F7F8F6',
      },
    },
    {
      id: 'pointOfInterest',
      label: {
        pinFillColor: '#9AA59E',
        pinGlyphColor: '#FFFFFF',
        pinOutlineColor: '#F7F8F6',
        textFillColor: '#707B74',
        textStrokeColor: '#F7F8F6',
      },
    },
    {
      id: 'pointOfInterest.recreation.park',
      geometry: {
        fillColor: '#E4EEDF',
      },
      label: {
        textFillColor: '#587357',
        textStrokeColor: '#F4F7F1',
      },
    },
    {
      id: 'pointOfInterest.recreation.sportsComplex',
      label: {
        pinFillColor: '#809A80',
        pinGlyphColor: '#FFFFFF',
      },
    },
    {
      id: 'pointOfInterest.emergency',
      label: {
        pinFillColor: '#C86C61',
        pinGlyphColor: '#FFFFFF',
        pinOutlineColor: '#F8F2EF',
      },
    },
    {
      id: 'pointOfInterest.other.placeOfWorship',
      label: {
        textFillColor: '#7A7067',
        textStrokeColor: '#F7F8F6',
      },
    },
    {
      id: 'political.city',
      label: {
        textFillColor: '#46534C',
        textStrokeColor: '#F4F6F2',
      },
    },
    {
      id: 'political.neighborhood',
      label: {
        textFillColor: '#65716A',
        textStrokeColor: '#F4F6F2',
      },
    },
  ],
};

export const PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE: PrintSwiftCloudMapStyleSpec = {
  variant: 'dark',
  backgroundColor: '#171D1A',
  metadata: {
    name: 'PrintSwift Midnight Discovery',
    description: 'Dark map styling for comfortable low-light discovery.',
    version: '1.0',
  },
  styles: [
    {
      id: 'natural.land',
      geometry: {
        fillColor: '#1D2521',
      },
    },
    {
      id: 'natural.base',
      geometry: {
        fillColor: '#1D2521',
      },
    },
    {
      id: 'natural.water',
      geometry: {
        fillColor: '#172F39',
        strokeColor: '#294651',
        strokeWeight: 1,
      },
      label: {
        textFillColor: '#9BB9C2',
        textStrokeColor: '#172F39',
      },
    },
    {
      id: 'natural.land.landCover.forest',
      geometry: {
        fillColor: '#23352B',
      },
    },
    {
      id: 'infrastructure.building',
      geometry: {
        fillColor: '#2A322E',
        strokeColor: '#35413A',
        strokeWeight: 0.5,
      },
    },
    {
      id: 'infrastructure.building.commercial',
      geometry: {
        fillColor: '#303A34',
        strokeColor: '#414D44',
        strokeWeight: 0.6,
      },
    },
    {
      id: 'infrastructure.roadNetwork.road',
      geometry: {
        strokeColor: '#414B45',
        strokeWeight: 2,
      },
      label: {
        textFillColor: '#B3BDB6',
        textStrokeColor: '#1D2521',
      },
    },
    {
      id: 'infrastructure.roadNetwork.road.local',
      geometry: {
        strokeColor: '#414B45',
        strokeWeight: 1.5,
      },
    },
    {
      id: 'infrastructure.roadNetwork.road.arterial',
      geometry: {
        strokeColor: '#62513F',
        strokeWeight: 2.5,
      },
    },
    {
      id: 'infrastructure.roadNetwork.road.highway',
      geometry: {
        strokeColor: '#806447',
        strokeWeight: 3.2,
      },
    },
    {
      id: 'infrastructure.roadNetwork.noTraffic.trail',
      geometry: {
        strokeColor: '#526A58',
        strokeWeight: 1.3,
      },
    },
    {
      id: 'infrastructure.railwayTrack',
      geometry: {
        strokeColor: '#68716B',
        strokeWeight: 1.2,
      },
    },
    {
      id: 'infrastructure.transitStation',
      label: {
        pinFillColor: '#84958B',
        pinGlyphColor: '#17201B',
        textFillColor: '#B3BEB5',
      },
    },
    {
      id: 'pointOfInterest',
      label: {
        pinFillColor: '#77887F',
        pinGlyphColor: '#17201B',
        pinOutlineColor: '#28332D',
        textFillColor: '#AAB6AE',
        textStrokeColor: '#1D2521',
      },
    },
    {
      id: 'pointOfInterest.recreation.park',
      geometry: {
        fillColor: '#294031',
      },
      label: {
        textFillColor: '#A4C09F',
        textStrokeColor: '#23352B',
      },
    },
    {
      id: 'pointOfInterest.recreation.sportsComplex',
      label: {
        pinFillColor: '#91A98D',
        pinGlyphColor: '#17201B',
      },
    },
    {
      id: 'pointOfInterest.emergency',
      label: {
        pinFillColor: '#C9756B',
        pinGlyphColor: '#FFFFFF',
        pinOutlineColor: '#332A28',
      },
    },
    {
      id: 'pointOfInterest.other.placeOfWorship',
      label: {
        textFillColor: '#C0B1A1',
        textStrokeColor: '#1D2521',
      },
    },
    {
      id: 'political.city',
      label: {
        textFillColor: '#E0E7E1',
        textStrokeColor: '#1D2521',
      },
    },
    {
      id: 'political.neighborhood',
      label: {
        textFillColor: '#AAB6AE',
        textStrokeColor: '#1D2521',
      },
    },
  ],
};

export const DEFAULT_FALLBACK_MAP_ID = 'DEMO_MAP_ID';

/**
 * Ensures a candidate Map ID is never an accidentally injected API key (starting with 'AIza').
 */
export function sanitizeMapId(candidate?: string | null): string {
  const trimmed = (candidate || '').trim();
  if (!trimmed || trimmed.startsWith('AIza')) {
    return '';
  }
  return trimmed;
}

export interface ResolvedCloudMapConfig {
  mapId: string;
  isFallbackDemoMapId: boolean;
  colorScheme: 'LIGHT' | 'DARK';
  variant: MapAppearanceVariant;
  mapTypeId: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  backgroundColor: string;
  styleSpec: PrintSwiftCloudMapStyleSpec;
  styleName: string;
}

/**
 * Resolves the effective Google Maps cloud-based styling configuration
 * without ever mixing legacy MapOptions.styles on the same map.
 */
export function resolveCloudMapConfiguration(params: {
  mapStyle: MapStyleOption;
  mapAppearance?: MapAppearanceVariant;
  configuredMapId?: string;
  configuredLightMapId?: string;
  configuredDarkMapId?: string;
}): ResolvedCloudMapConfig {
  const {
    mapStyle,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
  } = params;

  // Determine light vs dark appearance:
  // If mapStyle is explicitly 'dark', or mapAppearance is 'dark', use dark variant
  const variant: MapAppearanceVariant =
    mapStyle === 'dark'
      ? 'dark'
      : mapStyle === 'roadmap'
        ? mapAppearance || 'light'
        : mapAppearance || 'light';

  const styleSpec =
    variant === 'dark'
      ? PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE
      : PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE;

  const mapTypeId: 'roadmap' | 'satellite' | 'hybrid' | 'terrain' =
    mapStyle === 'dark' || mapStyle === 'roadmap' ? 'roadmap' : mapStyle;

  const envPrimaryId = sanitizeMapId(
    typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
      : ''
  );
  const envLightId = sanitizeMapId(
    typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_GOOGLE_MAPS_LIGHT_MAP_ID
      : ''
  );
  const envDarkId = sanitizeMapId(
    typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_GOOGLE_MAPS_DARK_MAP_ID
      : ''
  );

  const safeConfiguredDark = sanitizeMapId(configuredDarkMapId);
  const safeConfiguredLight = sanitizeMapId(configuredLightMapId);
  const safeConfiguredPrimary = sanitizeMapId(configuredMapId);

  const candidateId =
    variant === 'dark'
      ? safeConfiguredDark || envDarkId || safeConfiguredPrimary || envPrimaryId
      : safeConfiguredLight || envLightId || safeConfiguredPrimary || envPrimaryId;

  const effectiveMapId =
    candidateId && candidateId.length > 0
      ? candidateId
      : DEFAULT_FALLBACK_MAP_ID;

  const isFallbackDemoMapId = effectiveMapId === DEFAULT_FALLBACK_MAP_ID;

  return {
    mapId: effectiveMapId,
    isFallbackDemoMapId,
    colorScheme: variant === 'dark' ? 'DARK' : 'LIGHT',
    variant,
    mapTypeId,
    backgroundColor: styleSpec.backgroundColor,
    styleSpec,
    styleName: styleSpec.metadata.name,
  };
}

/**
 * Extracts a structured palette from the Cloud Map Style JSON specification
 * for the graceful vector fallback and style preview swatch cards.
 */
export function extractCloudStylePalette(spec: PrintSwiftCloudMapStyleSpec) {
  const findRule = (id: string) => spec.styles.find((r) => r.id === id);

  return {
    backgroundColor: spec.backgroundColor,
    landFill:
      findRule('natural.land')?.geometry?.fillColor || spec.backgroundColor,
    waterFill: findRule('natural.water')?.geometry?.fillColor || '#DCEAF0',
    waterStroke: findRule('natural.water')?.geometry?.strokeColor || '#C8DDE6',
    waterLabel:
      findRule('natural.water')?.label?.textFillColor || '#5B7885',
    forestFill:
      findRule('natural.land.landCover.forest')?.geometry?.fillColor ||
      '#E1EBDD',
    parkFill:
      findRule('pointOfInterest.recreation.park')?.geometry?.fillColor ||
      '#E4EEDF',
    parkLabel:
      findRule('pointOfInterest.recreation.park')?.label?.textFillColor ||
      '#587357',
    buildingFill:
      findRule('infrastructure.building')?.geometry?.fillColor || '#E8EAE5',
    buildingStroke:
      findRule('infrastructure.building')?.geometry?.strokeColor || '#DEE2DB',
    commercialBuildingFill:
      findRule('infrastructure.building.commercial')?.geometry?.fillColor ||
      '#E5E8E2',
    roadLocalStroke:
      findRule('infrastructure.roadNetwork.road.local')?.geometry
        ?.strokeColor || '#FFFFFF',
    roadArterialStroke:
      findRule('infrastructure.roadNetwork.road.arterial')?.geometry
        ?.strokeColor || '#F1D5B6',
    roadHighwayStroke:
      findRule('infrastructure.roadNetwork.road.highway')?.geometry
        ?.strokeColor || '#E7C39A',
    roadLabelFill:
      findRule('infrastructure.roadNetwork.road')?.label?.textFillColor ||
      '#68716C',
    roadLabelStroke:
      findRule('infrastructure.roadNetwork.road')?.label?.textStrokeColor ||
      spec.backgroundColor,
    trailStroke:
      findRule('infrastructure.roadNetwork.noTraffic.trail')?.geometry
        ?.strokeColor || '#B8C9AE',
    railwayStroke:
      findRule('infrastructure.railwayTrack')?.geometry?.strokeColor ||
      '#C5C9C2',
    poiPinFill:
      findRule('pointOfInterest')?.label?.pinFillColor || '#9AA59E',
    poiPinGlyph:
      findRule('pointOfInterest')?.label?.pinGlyphColor || '#FFFFFF',
    poiPinOutline:
      findRule('pointOfInterest')?.label?.pinOutlineColor ||
      spec.backgroundColor,
    poiTextFill:
      findRule('pointOfInterest')?.label?.textFillColor || '#707B74',
    emergencyPinFill:
      findRule('pointOfInterest.emergency')?.label?.pinFillColor || '#C86C61',
    cityLabelFill:
      findRule('political.city')?.label?.textFillColor || '#46534C',
    cityLabelStroke:
      findRule('political.city')?.label?.textStrokeColor || '#F4F6F2',
    neighborhoodLabelFill:
      findRule('political.neighborhood')?.label?.textFillColor || '#65716A',
    neighborhoodLabelStroke:
      findRule('political.neighborhood')?.label?.textStrokeColor || '#F4F6F2',
  };
}
