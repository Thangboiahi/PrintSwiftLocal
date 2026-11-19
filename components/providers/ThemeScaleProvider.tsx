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

export const DEFAULT_THEME_COLORS: ThemeColorsConfig = {
  primary: '221.2 83.2% 53.3%',   /* Blue */
  secondary: '210 40% 96.1%',     /* Slate/Gray */
  accent: '38 92% 50%',           /* Amber/Orange */
};

export const STORAGE_KEY_UI_SCALE = 'ui_scale';
export const STORAGE_KEY_SCALE_MATRIX = 'ui_scale_matrix';
export const STORAGE_KEY_THEME_COLORS = 'theme_colors';

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
  const match = hslString
    .trim()
    .match(/^([0-9.]+)\s+([0-9.]+)%?\s+([0-9.]+)%?$/);
  if (!match) return fallbackHex;

  const h = (parseFloat(match[1]) % 360) / 360;
  const s = Math.max(0, Math.min(100, parseFloat(match[2]))) / 100;
  const l = Math.max(0, Math.min(100, parseFloat(match[3]))) / 100;

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
  setUiScale: (scale: UiScaleOption | '14px' | '16px' | '18px') => void;
  setScaleMatrix: (matrix: Partial<ScaleMatrixConfig>) => void;
  setSmallPreset: () => ScaleMatrixConfig;
  setMediumPreset: () => ScaleMatrixConfig;
  setLargePreset: () => ScaleMatrixConfig;
  setThemeColors: (colors: Partial<ThemeColorsConfig>) => void;
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

export function applyScaleMatrixAndColorsToDom(
  matrix: ScaleMatrixConfig,
  colors: ThemeColorsConfig
) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const pxValue = `${matrix.text}px`;
  root.style.setProperty('--scale-text', pxValue);
  root.style.setProperty('--scale-pad', String(matrix.pad));
  root.style.setProperty('--scale-space', String(matrix.space));
  root.style.setProperty('--ui-scale', pxValue);
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-secondary', colors.secondary);
  root.style.setProperty('--color-accent', colors.accent);
  root.dataset.uiScale = deriveUiScalePresetFromMatrix(matrix);
}

export const ThemeScaleContext = createContext<ThemeScaleContextValue>({
  uiScale: 'medium',
  uiScalePx: '16px',
  scaleMatrix: DEFAULT_SCALE_MATRIX,
  themeColors: DEFAULT_THEME_COLORS,
  setUiScale: () => undefined,
  setScaleMatrix: () => undefined,
  setSmallPreset: () => SCALE_PRESETS.small,
  setMediumPreset: () => SCALE_PRESETS.medium,
  setLargePreset: () => SCALE_PRESETS.large,
  setThemeColors: () => undefined,
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

  // Phase 55-C: Hydrate from localStorage only after mount to guarantee SSR consistency
  useEffect(() => {
    queueMicrotask(() => {
      setIsMounted(true);
      if (typeof window === 'undefined') return;
      try {
        const savedPreset = normalizeUiScale(
          window.localStorage.getItem(STORAGE_KEY_UI_SCALE)
        );
        const storedMatrix = parseStoredScaleMatrix(
          window.localStorage.getItem(STORAGE_KEY_SCALE_MATRIX),
          savedPreset
        );
        const storedColors = parseStoredThemeColors(
          window.localStorage.getItem(STORAGE_KEY_THEME_COLORS)
        );
        setScaleMatrixState(storedMatrix);
        setThemeColorsState(storedColors);
        applyScaleMatrixAndColorsToDom(storedMatrix, storedColors);
      } catch {
        // ignore storage read errors
      }
    });
  }, []);

  // Synchronize 3-axis CSS variables on document.documentElement only after mount
  useEffect(() => {
    if (!isMounted) return;
    applyScaleMatrixAndColorsToDom(scaleMatrix, themeColors);
  }, [isMounted, scaleMatrix, themeColors]);

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
    (partialColors: Partial<ThemeColorsConfig>) => {
      setThemeColorsState((prev) => {
        const next: ThemeColorsConfig = {
          primary: partialColors.primary?.trim() || prev.primary,
          secondary: partialColors.secondary?.trim() || prev.secondary,
          accent: partialColors.accent?.trim() || prev.accent,
        };
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty(
            '--color-primary',
            next.primary
          );
          document.documentElement.style.setProperty(
            '--color-secondary',
            next.secondary
          );
          document.documentElement.style.setProperty(
            '--color-accent',
            next.accent
          );
        }
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              STORAGE_KEY_THEME_COLORS,
              JSON.stringify(next)
            );
          } catch {
            // ignore storage quota errors
          }
        }
        return next;
      });
    },
    []
  );

  const resetThemeScale = useCallback(() => {
    setScaleMatrixState(DEFAULT_SCALE_MATRIX);
    setThemeColorsState(DEFAULT_THEME_COLORS);
    applyScaleMatrixAndColorsToDom(DEFAULT_SCALE_MATRIX, DEFAULT_THEME_COLORS);
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
      } catch {
        // ignore
      }
    }
  }, []);

  const activeScaleMatrix = isMounted ? scaleMatrix : DEFAULT_SCALE_MATRIX;
  const activeThemeColors = isMounted ? themeColors : DEFAULT_THEME_COLORS;

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
      setUiScale,
      setScaleMatrix,
      setSmallPreset,
      setMediumPreset,
      setLargePreset,
      setThemeColors,
      resetThemeScale,
    }),
    [
      uiScale,
      activeScaleMatrix,
      activeThemeColors,
      setUiScale,
      setScaleMatrix,
      setSmallPreset,
      setMediumPreset,
      setLargePreset,
      setThemeColors,
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
