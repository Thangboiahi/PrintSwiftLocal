'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';

export type UiScaleOption = 'small' | 'medium' | 'large';

export interface ScaleMatrixConfig {
  text: number;
  pad: number;
  space: number;
}

export interface ThemeColorsConfig {
  primary: string;
  secondary: string;
  accent: string;
}

export type CuratedThemePresetId =
  | 'minimal_neutral'
  | 'warm_clay'
  | 'lamka_pine'
  | 'royal_indigo'
  | 'midnight_rose';

export type ThemePresetId = CuratedThemePresetId | 'custom';

export interface CuratedThemePresetDefinition {
  id: CuratedThemePresetId;
  name: string;
  tagline: string;
  colors: ThemeColorsConfig;
}

export const THEME_PRESETS: readonly CuratedThemePresetDefinition[] = [
  {
    id: 'minimal_neutral',
    name: 'Minimal Neutral',
    tagline: 'Architectural monochrome with crisp blue highlight (Default)',
    colors: {
      primary: '222 47% 14%',
      secondary: '210 20% 96%',
      accent: '221 83% 53%',
    },
  },
  {
    id: 'warm_clay',
    name: 'Warm Clay',
    tagline: 'Earth-toned terracotta with sunlit amber warmth',
    colors: {
      primary: '18 65% 44%',
      secondary: '32 33% 95%',
      accent: '38 92% 48%',
    },
  },
  {
    id: 'lamka_pine',
    name: 'Lamka Pine',
    tagline: 'Churachandpur hill-district greens with golden accent',
    colors: {
      primary: '158 64% 30%',
      secondary: '152 24% 95%',
      accent: '36 88% 48%',
    },
  },
  {
    id: 'royal_indigo',
    name: 'Royal Indigo',
    tagline: 'Precision deep indigo paired with bright sky highlights',
    colors: {
      primary: '234 62% 48%',
      secondary: '228 35% 96%',
      accent: '199 89% 46%',
    },
  },
  {
    id: 'midnight_rose',
    name: 'Midnight Rose',
    tagline: 'Refined berry-crimson primary with coral sunset accent',
    colors: {
      primary: '342 58% 42%',
      secondary: '340 20% 96%',
      accent: '24 85% 50%',
    },
  },
] as const;

export const DEFAULT_THEME_PRESET: CuratedThemePresetId = 'minimal_neutral';

export const DEFAULT_THEME_COLORS: ThemeColorsConfig = {
  ...THEME_PRESETS[0].colors,
};

export const SCALE_PRESETS: Record<UiScaleOption, ScaleMatrixConfig> = {
  small: { text: 14, pad: 0.8, space: 0.8 },
  medium: { text: 16, pad: 1, space: 1 },
  large: { text: 18, pad: 1.2, space: 1.2 },
};

export const UI_SCALE_PX_MAP: Record<UiScaleOption, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
};

export const DEFAULT_UI_SCALE: UiScaleOption = 'medium';

export const DEFAULT_SCALE_MATRIX: ScaleMatrixConfig = {
  text: 16,
  pad: 1,
  space: 1,
};

export const STORAGE_KEY_UI_SCALE = 'ui_scale';
export const STORAGE_KEY_SCALE_MATRIX = 'ui_scale_matrix';
export const STORAGE_KEY_THEME_COLORS = 'theme_colors';
export const STORAGE_KEY_THEME_PRESET = 'theme_preset_id';

export function getPresetById(
  presetId: string | null | undefined
): CuratedThemePresetDefinition | null {
  if (!presetId) return null;
  const normalized = presetId.trim().toLowerCase();
  const legacyMap: Record<string, CuratedThemePresetId> = {
    neutral: 'minimal_neutral',
    slate: 'minimal_neutral',
    clay: 'warm_clay',
    forest: 'lamka_pine',
    ocean: 'royal_indigo',
  };
  const resolvedId = legacyMap[normalized] || normalized;
  return THEME_PRESETS.find((preset) => preset.id === resolvedId) ?? null;
}

export function normalizeThemePresetId(
  raw: string | null | undefined
): ThemePresetId {
  if (!raw) return DEFAULT_THEME_PRESET;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'custom') return 'custom';
  const matched = getPresetById(trimmed);
  return matched ? matched.id : DEFAULT_THEME_PRESET;
}

interface ParsedHsl {
  h: number;
  s: number;
  l: number;
}

function parseHslTriplet(hslString: string): ParsedHsl | null {
  const match = hslString
    .trim()
    .match(/^([0-9.]+)\s+([0-9.]+)%?\s+([0-9.]+)%?$/);
  if (!match) return null;
  return {
    h: parseFloat(match[1]) % 360,
    s: Math.max(0, Math.min(100, parseFloat(match[2]))),
    l: Math.max(0, Math.min(100, parseFloat(match[3]))),
  };
}

/**
 * Computes dark-mode luminance-safe primary/secondary tokens and guaranteed
 * high-contrast `--color-primary-foreground` so text inside `bg-theme-primary`
 * buttons is always readable in both Light and Dark modes.
 */
export function resolveSafeThemeCssTokens(
  colors: ThemeColorsConfig,
  isDark: boolean
): {
  primary: string;
  primaryForeground: string;
  secondary: string;
  accent: string;
} {
  const parsedPrimary = parseHslTriplet(colors.primary);
  let effectivePrimary = colors.primary;
  let effectivePrimaryL = parsedPrimary?.l ?? 45;

  if (parsedPrimary && isDark && parsedPrimary.l < 35) {
    if (parsedPrimary.l <= 20 && parsedPrimary.s <= 50) {
      // Dark neutral primary (e.g., Minimal Neutral 222 47% 14%) -> crisp slate-white in Dark Mode
      effectivePrimary = '210 40% 96%';
      effectivePrimaryL = 96;
    } else {
      // Rich dark brand hue (e.g., Lamka Pine 158 64% 30%) -> lift lightness for legibility on dark surfaces
      const liftedL = 56;
      const liftedS = Math.min(82, Math.max(parsedPrimary.s, 48));
      effectivePrimary = `${Number(parsedPrimary.h.toFixed(1))} ${Number(
        liftedS.toFixed(1)
      )}% ${liftedL}%`;
      effectivePrimaryL = liftedL;
    }
  } else if (parsedPrimary && isDark && parsedPrimary.l < 48) {
    // Slightly brighten mid-dark brand hues in dark mode for crisp text/icon contrast
    const liftedL = 60;
    effectivePrimary = `${Number(parsedPrimary.h.toFixed(1))} ${Number(
      parsedPrimary.s.toFixed(1)
    )}% ${liftedL}%`;
    effectivePrimaryL = liftedL;
  }

  const primaryForeground =
    effectivePrimaryL >= 62 ? '222 47% 11%' : '0 0% 100%';

  const parsedSecondary = parseHslTriplet(colors.secondary);
  let effectiveSecondary = colors.secondary;
  if (parsedSecondary && isDark && parsedSecondary.l > 65) {
    effectiveSecondary = `${Number(parsedSecondary.h.toFixed(1))} ${Number(
      Math.min(parsedSecondary.s, 28).toFixed(1)
    )}% 16%`;
  }

  return {
    primary: effectivePrimary,
    primaryForeground,
    secondary: effectiveSecondary,
    accent: colors.accent,
  };
}

/**
 * Converts a 6-digit Hex color (e.g., "#2563eb") into a space-separated HSL string
 * compatible with Tailwind CSS variables (e.g., "221.2 83.2% 53.3%").
 */
export function hexToHsl(hexInput: string): string {
  const cleanHex = hexInput.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
    return DEFAULT_THEME_COLORS.primary;
  }
  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  const hDeg = Number((h * 360).toFixed(1));
  const sPct = Number((s * 100).toFixed(1));
  const lPct = Number((l * 100).toFixed(1));
  return `${hDeg} ${sPct}% ${lPct}%`;
}

/**
 * Converts a space-separated HSL string (e.g., "221.2 83.2% 53.3%") into a 6-digit Hex string
 * (e.g., "#2563eb") for <input type="color" /> controls.
 */
export function hslToHex(hslString: string, fallbackHex = '#2563eb'): string {
  const parsed = parseHslTriplet(hslString);
  if (!parsed) return fallbackHex;

  const h = parsed.h / 360;
  const s = parsed.s / 100;
  const l = parsed.l / 100;

  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let adjT = t;
      if (adjT < 0) adjT += 1;
      if (adjT > 1) adjT -= 1;
      if (adjT < 1 / 6) return p + (q - p) * 6 * adjT;
      if (adjT < 1 / 2) return q;
      if (adjT < 2 / 3) return p + (q - p) * (2 / 3 - adjT) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface ThemeScaleContextValue {
  uiScale: UiScaleOption;
  uiScalePx: string;
  scaleMatrix: ScaleMatrixConfig;
  themeColors: ThemeColorsConfig;
  activePreset: ThemePresetId;
  setUiScale: (scale: UiScaleOption | '14px' | '16px' | '18px') => void;
  setScaleMatrix: (matrix: Partial<ScaleMatrixConfig>) => void;
  setSmallPreset: () => ScaleMatrixConfig;
  setMediumPreset: () => ScaleMatrixConfig;
  setLargePreset: () => ScaleMatrixConfig;
  setThemeColors: (
    colors: Partial<ThemeColorsConfig>,
    options?: { presetId?: ThemePresetId }
  ) => void;
  selectThemePreset: (presetId: CuratedThemePresetId) => ThemeColorsConfig;
  resetThemeScale: () => void;
}

export function normalizeUiScale(raw: string | null | undefined): UiScaleOption {
  if (!raw) return 'medium';
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'small' || trimmed === '14px') return 'small';
  if (trimmed === 'large' || trimmed === '18px') return 'large';
  return 'medium';
}

export function deriveUiScalePresetFromMatrix(
  matrix: ScaleMatrixConfig
): UiScaleOption {
  if (matrix.text <= 14) return 'small';
  if (matrix.text >= 18) return 'large';
  return 'medium';
}

export function parseStoredScaleMatrix(
  rawMatrix: string | null | undefined,
  fallbackScaleOption: UiScaleOption = 'medium'
): ScaleMatrixConfig {
  const presetFallback =
    SCALE_PRESETS[fallbackScaleOption] || DEFAULT_SCALE_MATRIX;
  if (!rawMatrix) return presetFallback;
  try {
    const parsed = JSON.parse(rawMatrix) as Partial<ScaleMatrixConfig>;
    return {
      text:
        typeof parsed?.text === 'number' && Number.isFinite(parsed.text)
          ? parsed.text
          : presetFallback.text,
      pad:
        typeof parsed?.pad === 'number' && Number.isFinite(parsed.pad)
          ? parsed.pad
          : presetFallback.pad,
      space:
        typeof parsed?.space === 'number' && Number.isFinite(parsed.space)
          ? parsed.space
          : presetFallback.space,
    };
  } catch {
    return presetFallback;
  }
}

function parseStoredThemeColors(raw: string | null | undefined): ThemeColorsConfig {
  if (!raw) return DEFAULT_THEME_COLORS;
  try {
    const parsed = JSON.parse(raw) as Partial<ThemeColorsConfig>;
    return {
      primary:
        typeof parsed?.primary === 'string' && parsed.primary.trim()
          ? parsed.primary.trim()
          : DEFAULT_THEME_COLORS.primary,
      secondary:
        typeof parsed?.secondary === 'string' && parsed.secondary.trim()
          ? parsed.secondary.trim()
          : DEFAULT_THEME_COLORS.secondary,
      accent:
        typeof parsed?.accent === 'string' && parsed.accent.trim()
          ? parsed.accent.trim()
          : DEFAULT_THEME_COLORS.accent,
    };
  } catch {
    return DEFAULT_THEME_COLORS;
  }
}

function matchCuratedPresetForColors(
  colors: ThemeColorsConfig
): ThemePresetId {
  const matched = THEME_PRESETS.find(
    (p) =>
      p.colors.primary === colors.primary &&
      p.colors.secondary === colors.secondary &&
      p.colors.accent === colors.accent
  );
  return matched ? matched.id : 'custom';
}

export function applyScaleMatrixAndColorsToDom(
  matrix: ScaleMatrixConfig,
  colors: ThemeColorsConfig,
  presetId?: ThemePresetId
) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');
  const resolved = resolveSafeThemeCssTokens(colors, isDark);

  const pxValue = `${matrix.text}px`;
  root.style.setProperty('--scale-text', pxValue);
  root.style.setProperty('--scale-pad', String(matrix.pad));
  root.style.setProperty('--scale-space', String(matrix.space));
  root.style.setProperty('--ui-scale', pxValue);

  root.style.setProperty('--color-primary', resolved.primary);
  root.style.setProperty(
    '--color-primary-foreground',
    resolved.primaryForeground
  );
  root.style.setProperty('--color-secondary', resolved.secondary);
  root.style.setProperty('--color-accent', resolved.accent);

  // Sync legacy --ps-accent variables so all existing modules immediately reflect the unified palette
  root.style.setProperty('--ps-accent', `hsl(${resolved.primary})`);
  root.style.setProperty(
    '--ps-accent-fg',
    `hsl(${resolved.primaryForeground})`
  );

  root.dataset.uiScale = deriveUiScalePresetFromMatrix(matrix);
  if (presetId) {
    root.dataset.colorPreset = presetId;
  }
}

export const ThemeScaleContext = createContext<ThemeScaleContextValue>({
  uiScale: 'medium',
  uiScalePx: '16px',
  scaleMatrix: DEFAULT_SCALE_MATRIX,
  themeColors: DEFAULT_THEME_COLORS,
  activePreset: DEFAULT_THEME_PRESET,
  setUiScale: () => undefined,
  setScaleMatrix: () => undefined,
  setSmallPreset: () => SCALE_PRESETS.small,
  setMediumPreset: () => SCALE_PRESETS.medium,
  setLargePreset: () => SCALE_PRESETS.large,
  setThemeColors: () => undefined,
  selectThemePreset: () => DEFAULT_THEME_COLORS,
  resetThemeScale: () => undefined,
});

export function useThemeScale(): ThemeScaleContextValue {
  return useContext(ThemeScaleContext);
}

export function ThemeScaleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [scaleMatrix, setScaleMatrixState] =
    useState<ScaleMatrixConfig>(DEFAULT_SCALE_MATRIX);
  const [themeColors, setThemeColorsState] =
    useState<ThemeColorsConfig>(DEFAULT_THEME_COLORS);
  const [activePreset, setActivePresetState] =
    useState<ThemePresetId>(DEFAULT_THEME_PRESET);

  // Hydrate from localStorage only after mount to guarantee SSR consistency
  useEffect(() => {
    queueMicrotask(() => {
      setIsMounted(true);
      if (typeof window === 'undefined') return;
      try {
        const savedScalePreset = normalizeUiScale(
          window.localStorage.getItem(STORAGE_KEY_UI_SCALE)
        );
        const storedMatrix = parseStoredScaleMatrix(
          window.localStorage.getItem(STORAGE_KEY_SCALE_MATRIX),
          savedScalePreset
        );

        const rawPresetId = window.localStorage.getItem(
          STORAGE_KEY_THEME_PRESET
        );
        const rawColors = window.localStorage.getItem(STORAGE_KEY_THEME_COLORS);

        let resolvedPreset: ThemePresetId = DEFAULT_THEME_PRESET;
        let resolvedColors: ThemeColorsConfig = DEFAULT_THEME_COLORS;

        if (rawPresetId) {
          resolvedPreset = normalizeThemePresetId(rawPresetId);
          if (resolvedPreset === 'custom' && rawColors) {
            resolvedColors = parseStoredThemeColors(rawColors);
          } else {
            const matched = getPresetById(resolvedPreset);
            resolvedColors = matched
              ? { ...matched.colors }
              : DEFAULT_THEME_COLORS;
          }
        } else if (rawColors) {
          const parsedColors = parseStoredThemeColors(rawColors);
          // Migrate legacy bright-blue default cleanly to Minimal Neutral
          const isLegacyBlueDefault =
            parsedColors.primary === '221.2 83.2% 53.3%' &&
            parsedColors.secondary === '210 40% 96.1%' &&
            parsedColors.accent === '38 92% 50%';
          if (isLegacyBlueDefault) {
            resolvedPreset = DEFAULT_THEME_PRESET;
            resolvedColors = DEFAULT_THEME_COLORS;
          } else {
            resolvedColors = parsedColors;
            resolvedPreset = matchCuratedPresetForColors(parsedColors);
          }
        }

        setScaleMatrixState(storedMatrix);
        setThemeColorsState(resolvedColors);
        setActivePresetState(resolvedPreset);
        applyScaleMatrixAndColorsToDom(
          storedMatrix,
          resolvedColors,
          resolvedPreset
        );
      } catch {
        // ignore storage read errors
      }
    });
  }, []);

  // Synchronize CSS variables whenever scale, colors, or preset changes
  useEffect(() => {
    if (!isMounted) return;
    applyScaleMatrixAndColorsToDom(scaleMatrix, themeColors, activePreset);
  }, [isMounted, scaleMatrix, themeColors, activePreset]);

  // Watch html.classList for Light/Dark switches so Dark-Mode Luminance Safety reapplies immediately
  useEffect(() => {
    if (!isMounted || typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      applyScaleMatrixAndColorsToDom(scaleMatrix, themeColors, activePreset);
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [isMounted, scaleMatrix, themeColors, activePreset]);

  const setScaleMatrix = useCallback(
    (partialMatrix: Partial<ScaleMatrixConfig>) => {
      setScaleMatrixState((prev) => {
        const next: ScaleMatrixConfig = {
          text:
            typeof partialMatrix.text === 'number' &&
            Number.isFinite(partialMatrix.text)
              ? partialMatrix.text
              : prev.text,
          pad:
            typeof partialMatrix.pad === 'number' &&
            Number.isFinite(partialMatrix.pad)
              ? partialMatrix.pad
              : prev.pad,
          space:
            typeof partialMatrix.space === 'number' &&
            Number.isFinite(partialMatrix.space)
              ? partialMatrix.space
              : prev.space,
        };
        const derivedPreset = deriveUiScalePresetFromMatrix(next);
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty(
            '--scale-text',
            `${next.text}px`
          );
          document.documentElement.style.setProperty(
            '--scale-pad',
            String(next.pad)
          );
          document.documentElement.style.setProperty(
            '--scale-space',
            String(next.space)
          );
          document.documentElement.style.setProperty(
            '--ui-scale',
            `${next.text}px`
          );
          document.documentElement.dataset.uiScale = derivedPreset;
        }
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              STORAGE_KEY_SCALE_MATRIX,
              JSON.stringify(next)
            );
            window.localStorage.setItem(STORAGE_KEY_UI_SCALE, derivedPreset);
          } catch {
            // ignore storage quota errors
          }
        }
        return next;
      });
    },
    []
  );

  const setSmallPreset = useCallback((): ScaleMatrixConfig => {
    const next = { text: 14, pad: 0.8, space: 0.8 };
    setScaleMatrix(next);
    return next;
  }, [setScaleMatrix]);

  const setMediumPreset = useCallback((): ScaleMatrixConfig => {
    const next = { text: 16, pad: 1, space: 1 };
    setScaleMatrix(next);
    return next;
  }, [setScaleMatrix]);

  const setLargePreset = useCallback((): ScaleMatrixConfig => {
    const next = { text: 18, pad: 1.2, space: 1.2 };
    setScaleMatrix(next);
    return next;
  }, [setScaleMatrix]);

  const setUiScale = useCallback(
    (nextScaleInput: UiScaleOption | '14px' | '16px' | '18px') => {
      const normalized = normalizeUiScale(nextScaleInput);
      const preset = SCALE_PRESETS[normalized];
      setScaleMatrix(preset);
    },
    [setScaleMatrix]
  );

  const setThemeColors = useCallback(
    (
      partialColors: Partial<ThemeColorsConfig>,
      options?: { presetId?: ThemePresetId }
    ) => {
      setThemeColorsState((prev) => {
        const next: ThemeColorsConfig = {
          primary: partialColors.primary?.trim() || prev.primary,
          secondary: partialColors.secondary?.trim() || prev.secondary,
          accent: partialColors.accent?.trim() || prev.accent,
        };
        const nextPreset: ThemePresetId = options?.presetId ?? 'custom';
        setActivePresetState(nextPreset);
        applyScaleMatrixAndColorsToDom(scaleMatrix, next, nextPreset);

        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              STORAGE_KEY_THEME_COLORS,
              JSON.stringify(next)
            );
            window.localStorage.setItem(STORAGE_KEY_THEME_PRESET, nextPreset);
          } catch {
            // ignore storage quota errors
          }
        }
        return next;
      });
    },
    [scaleMatrix]
  );

  const selectThemePreset = useCallback(
    (presetId: CuratedThemePresetId): ThemeColorsConfig => {
      const matched = getPresetById(presetId) || THEME_PRESETS[0];
      const nextColors: ThemeColorsConfig = { ...matched.colors };
      setThemeColorsState(nextColors);
      setActivePresetState(matched.id);
      applyScaleMatrixAndColorsToDom(scaleMatrix, nextColors, matched.id);

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            STORAGE_KEY_THEME_COLORS,
            JSON.stringify(nextColors)
          );
          window.localStorage.setItem(STORAGE_KEY_THEME_PRESET, matched.id);
        } catch {
          // ignore storage quota errors
        }
      }
      return nextColors;
    },
    [scaleMatrix]
  );

  const resetThemeScale = useCallback(() => {
    setScaleMatrixState(DEFAULT_SCALE_MATRIX);
    setThemeColorsState(DEFAULT_THEME_COLORS);
    setActivePresetState(DEFAULT_THEME_PRESET);
    applyScaleMatrixAndColorsToDom(
      DEFAULT_SCALE_MATRIX,
      DEFAULT_THEME_COLORS,
      DEFAULT_THEME_PRESET
    );
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY_UI_SCALE, 'medium');
        window.localStorage.setItem(
          STORAGE_KEY_SCALE_MATRIX,
          JSON.stringify(DEFAULT_SCALE_MATRIX)
        );
        window.localStorage.setItem(
          STORAGE_KEY_THEME_COLORS,
          JSON.stringify(DEFAULT_THEME_COLORS)
        );
        window.localStorage.setItem(
          STORAGE_KEY_THEME_PRESET,
          DEFAULT_THEME_PRESET
        );
      } catch {
        // ignore
      }
    }
  }, []);

  const activeScaleMatrix = isMounted ? scaleMatrix : DEFAULT_SCALE_MATRIX;
  const activeThemeColors = isMounted ? themeColors : DEFAULT_THEME_COLORS;
  const resolvedActivePreset = isMounted ? activePreset : DEFAULT_THEME_PRESET;

  const uiScale = useMemo(
    () => deriveUiScalePresetFromMatrix(activeScaleMatrix),
    [activeScaleMatrix]
  );

  const contextValue = useMemo<ThemeScaleContextValue>(
    () => ({
      uiScale,
      uiScalePx: `${activeScaleMatrix.text}px`,
      scaleMatrix: activeScaleMatrix,
      themeColors: activeThemeColors,
      activePreset: resolvedActivePreset,
      setUiScale,
      setScaleMatrix,
      setSmallPreset,
      setMediumPreset,
      setLargePreset,
      setThemeColors,
      selectThemePreset,
      resetThemeScale,
    }),
    [
      uiScale,
      activeScaleMatrix,
      activeThemeColors,
      resolvedActivePreset,
      setUiScale,
      setScaleMatrix,
      setSmallPreset,
      setMediumPreset,
      setLargePreset,
      setThemeColors,
      selectThemePreset,
      resetThemeScale,
    ]
  );

  return (
    <ThemeScaleContext.Provider value={contextValue}>
      {children}
    </ThemeScaleContext.Provider>
  );
}

export default ThemeScaleProvider;
