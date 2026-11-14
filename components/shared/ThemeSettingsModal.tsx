'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Compass,
  Copy,
  Download,
  Home,
  Info,
  Layers,
  Loader2,
  Map as MapIcon,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Ruler,
  Sliders,
  Sun,
  X,
} from 'lucide-react';
import {
  PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE,
  PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE,
  resolveCloudMapConfiguration,
} from '@/lib/map-cloud-styles';
import { useAppStore, useRealEstateMode, useSimpleMode } from '@/lib/store';
import {
  AppearanceMode,
  AreaUnit,
  MapAppearanceVariant,
  MapStyleOption,
  ThemePreset,
} from '@/lib/types';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isElementFocusable(
  el: HTMLElement | null | undefined
): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.getClientRects().length > 0;
}

export function getModalFocusableElements(
  container: HTMLElement
): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
  return candidates.filter((el) => isElementFocusable(el));
}

function focusModalInitialTarget(dialogEl: HTMLElement): HTMLElement {
  const focusables = getModalFocusableElements(dialogEl);
  if (focusables.length > 0) {
    focusables[0].focus({ preventScroll: true });
    return focusables[0];
  }
  const heading = dialogEl.querySelector<HTMLElement>(
    'h1, h2, h3, [role="heading"]'
  );
  if (heading) {
    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
    }
    heading.focus({ preventScroll: true });
    return heading;
  }
  if (!dialogEl.hasAttribute('tabindex')) {
    dialogEl.setAttribute('tabindex', '-1');
  }
  dialogEl.focus({ preventScroll: true });
  return dialogEl;
}

interface ActiveModalStackEntry {
  id: string;
  getDialogEl: () => HTMLElement | null;
  triggerElement: HTMLElement | null;
  lastInternalFocus: HTMLElement | null;
  fallbackTriggerSelector?: string;
}

const activeModalStack: ActiveModalStackEntry[] = [];
let lastUserInteractedElement: HTMLElement | null = null;
let lastUserInteractionTimestamp = 0;
let globalInteractionTrackingAttached = false;

function ensureGlobalInteractionTracking() {
  if (globalInteractionTrackingAttached || typeof document === 'undefined') {
    return;
  }
  globalInteractionTrackingAttached = true;
  const recordInteraction = (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const focusable = target.closest<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable) {
      lastUserInteractedElement = focusable;
      lastUserInteractionTimestamp = Date.now();
    }
  };
  document.addEventListener('pointerdown', recordInteraction, true);
  document.addEventListener('keydown', recordInteraction, true);
  document.addEventListener('click', recordInteraction, true);
}

export function isTopmostActiveModal(id: string): boolean {
  if (activeModalStack.length === 0) return false;
  return activeModalStack[activeModalStack.length - 1].id === id;
}

export function useModalFocusManagement({
  id,
  open,
  dialogRef,
  dialogSelector,
  fallbackTriggerSelector,
}: {
  id: string;
  open: boolean;
  dialogRef?: React.RefObject<HTMLElement | null>;
  dialogSelector?: string;
  fallbackTriggerSelector?: string;
}) {
  useEffect(() => {
    ensureGlobalInteractionTracking();
  }, []);

  useEffect(() => {
    if (!open) return;
    ensureGlobalInteractionTracking();

    const getDialogEl = (): HTMLElement | null => {
      if (dialogRef?.current) return dialogRef.current;
      if (dialogSelector) {
        return document.querySelector<HTMLElement>(dialogSelector);
      }
      return null;
    };

    const dialogEl = getDialogEl();
    const prevTop =
      activeModalStack.length > 0
        ? activeModalStack[activeModalStack.length - 1]
        : null;
    const currentActive = document.activeElement as HTMLElement | null;

    if (prevTop) {
      const prevDialogEl = prevTop.getDialogEl();
      if (
        prevDialogEl &&
        currentActive &&
        prevDialogEl.contains(currentActive)
      ) {
        prevTop.lastInternalFocus = currentActive;
      }
    }

    let triggerElement: HTMLElement | null = null;
    const isFreshInteraction = Date.now() - lastUserInteractionTimestamp < 350;
    if (
      isFreshInteraction &&
      lastUserInteractedElement &&
      (!dialogEl || !dialogEl.contains(lastUserInteractedElement))
    ) {
      triggerElement = lastUserInteractedElement;
    } else if (
      currentActive &&
      currentActive !== document.body &&
      currentActive !== document.documentElement &&
      (!dialogEl || !dialogEl.contains(currentActive))
    ) {
      triggerElement = currentActive;
    } else if (
      lastUserInteractedElement &&
      (!dialogEl || !dialogEl.contains(lastUserInteractedElement))
    ) {
      triggerElement = lastUserInteractedElement;
    }

    const entry: ActiveModalStackEntry = {
      id,
      getDialogEl,
      triggerElement,
      lastInternalFocus: null,
      fallbackTriggerSelector,
    };

    const existingIdx = activeModalStack.findIndex((item) => item.id === id);
    if (existingIdx !== -1) {
      activeModalStack.splice(existingIdx, 1);
    }
    activeModalStack.push(entry);

    if (dialogEl) {
      entry.lastInternalFocus = focusModalInitialTarget(dialogEl);
    }

    const handleFocusIn = (ev: FocusEvent) => {
      if (!isTopmostActiveModal(id)) return;
      const currentDialogEl = getDialogEl();
      if (!currentDialogEl) return;
      const target = ev.target as HTMLElement | null;
      if (target && currentDialogEl.contains(target)) {
        entry.lastInternalFocus = target;
      }
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Tab') return;
      if (!isTopmostActiveModal(id)) return;
      const currentDialogEl = getDialogEl();
      if (!currentDialogEl) return;

      const focusables = getModalFocusableElements(currentDialogEl);
      if (focusables.length === 0) {
        ev.preventDefault();
        entry.lastInternalFocus = focusModalInitialTarget(currentDialogEl);
        return;
      }

      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const currentIndex = activeEl ? focusables.indexOf(activeEl) : -1;

      ev.preventDefault();
      if (ev.shiftKey) {
        if (currentIndex <= 0) {
          lastEl.focus();
          entry.lastInternalFocus = lastEl;
        } else {
          const prevEl = focusables[currentIndex - 1];
          prevEl.focus();
          entry.lastInternalFocus = prevEl;
        }
      } else {
        if (currentIndex === -1 || currentIndex === focusables.length - 1) {
          firstEl.focus();
          entry.lastInternalFocus = firstEl;
        } else {
          const nextEl = focusables[currentIndex + 1];
          nextEl.focus();
          entry.lastInternalFocus = nextEl;
        }
      }
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('keydown', handleKeyDown, true);

      const idx = activeModalStack.indexOf(entry);
      if (idx !== -1) {
        activeModalStack.splice(idx, 1);
      }

      const restoreFocus = () => {
        const underlyingEntry =
          activeModalStack.length > 0
            ? activeModalStack[activeModalStack.length - 1]
            : null;

        if (underlyingEntry) {
          const underlyingDialogEl = underlyingEntry.getDialogEl();
          if (underlyingDialogEl && underlyingDialogEl.isConnected) {
            if (
              entry.triggerElement &&
              underlyingDialogEl.contains(entry.triggerElement) &&
              isElementFocusable(entry.triggerElement)
            ) {
              entry.triggerElement.focus({ preventScroll: true });
              underlyingEntry.lastInternalFocus = entry.triggerElement;
              return;
            }
            if (
              underlyingEntry.lastInternalFocus &&
              underlyingDialogEl.contains(underlyingEntry.lastInternalFocus) &&
              isElementFocusable(underlyingEntry.lastInternalFocus)
            ) {
              underlyingEntry.lastInternalFocus.focus({ preventScroll: true });
              return;
            }
            underlyingEntry.lastInternalFocus =
              focusModalInitialTarget(underlyingDialogEl);
            return;
          }
        }

        if (isElementFocusable(entry.triggerElement)) {
          entry.triggerElement.focus({ preventScroll: true });
          return;
        }

        if (entry.fallbackTriggerSelector) {
          const fallbackEl = document.querySelector<HTMLElement>(
            entry.fallbackTriggerSelector
          );
          if (isElementFocusable(fallbackEl)) {
            fallbackEl.focus({ preventScroll: true });
          }
        }
      };

      restoreFocus();
      queueMicrotask(() => {
        if (
          document.activeElement === document.body ||
          document.activeElement === document.documentElement
        ) {
          restoreFocus();
        }
      });
    };
  }, [id, open, dialogRef, dialogSelector, fallbackTriggerSelector]);
}

interface ThemeSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const PRESETS: Array<{
  id: ThemePreset;
  name: string;
  description: string;
  swatchBg: string;
  swatchAccent: string;
}> = [
  {
    id: 'neutral',
    name: 'Minimal Neutral',
    description: 'Clean, restrained architectural monochrome (Default)',
    swatchBg: '#f8fafc',
    swatchAccent: '#18181b',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Crisp coastal blue surfaces and high-legibility sky accents',
    swatchBg: '#f0f7ff',
    swatchAccent: '#0284c7',
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Botanical hill-district greens with high contrast',
    swatchBg: '#f2f8f5',
    swatchAccent: '#059669',
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Precision engineering cool-slate palette',
    swatchBg: '#f8fafc',
    swatchAccent: '#334155',
  },
  {
    id: 'clay',
    name: 'Warm Clay',
    description: 'Earth-toned stone and warm amber highlights',
    swatchBg: '#faf6f3',
    swatchAccent: '#b45309',
  },
];

const CLOUD_APPEARANCES: Array<{
  id: MapAppearanceVariant;
  name: string;
  subtitle: string;
  bgHex: string;
  landHex: string;
  waterHex: string;
  roadHex: string;
}> = [
  {
    id: 'light',
    name: 'PrintSwift Neutral Discovery',
    subtitle: 'Light Cloud Style (colorScheme: LIGHT · #F7F8F6)',
    bgHex: '#F7F8F6',
    landHex: '#F4F6F2',
    waterHex: '#DCEAF0',
    roadHex: '#E7C39A',
  },
  {
    id: 'dark',
    name: 'PrintSwift Midnight Discovery',
    subtitle: 'Dark Cloud Style (colorScheme: DARK · #171D1A)',
    bgHex: '#171D1A',
    landHex: '#1D2521',
    waterHex: '#172F39',
    roadHex: '#806447',
  },
];

const BASE_MAP_TYPES: Array<{
  id: MapStyleOption;
  label: string;
  note: string;
}> = [
  {
    id: 'roadmap',
    label: 'Roadmap',
    note: 'Vector street map with active Light/Dark Cloud Style',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    note: 'Aerial orthophotography (imagery only)',
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    note: 'Satellite imagery with road & locality labels',
  },
  {
    id: 'terrain',
    label: 'Terrain',
    note: 'Topographic relief & elevation contours',
  },
];

export function ThemeSettingsModal({ open, onClose }: ThemeSettingsModalProps) {
  const {
    appearanceMode,
    setAppearanceMode,
    themePreset,
    setThemePreset,
    resetThemeToDefault,
    mapStyle,
    setMapStyle,
    mapAppearance,
    setMapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    setConfiguredMapIds,
    mapCloudFallbackNotice,
    useVectorStylePreview,
    setUseVectorStylePreview,
    areaUnit,
    setAreaUnit,
    customDefaultCenter,
    setCustomDefaultCenter,
    resetCustomDefaultCenter,
    currentMapCenter,
  } = useAppStore();
  const [simpleMode, setSimpleMode] = useSimpleMode();
  const [isRealEstateMode, setRealEstateMode] = useRealEstateMode();

  const [saveCenterFeedback, setSaveCenterFeedback] = useState<string | null>(
    null
  );
  const [draftMapId, setDraftMapId] = useState(configuredMapId);
  const [draftLightMapId, setDraftLightMapId] = useState(configuredLightMapId);
  const [draftDarkMapId, setDraftDarkMapId] = useState(configuredDarkMapId);
  const [mapIdValidationError, setMapIdValidationError] = useState<string | null>(
    null
  );
  const [isApplyingMapIds, setIsApplyingMapIds] = useState(false);
  const [copiedVariant, setCopiedVariant] = useState<'light' | 'dark' | null>(
    null
  );
  const [showJsonInspector, setShowJsonInspector] = useState<
    'none' | 'light' | 'dark'
  >('none');
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useModalFocusManagement({
    id: 'theme-settings-modal',
    open,
    dialogRef,
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (!isTopmostActiveModal('theme-settings-modal')) return;
      if (document.getElementById('reset-demo-modal-title')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const resolvedMapCfg = resolveCloudMapConfiguration({
    mapStyle,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
  });

  const activeBaseType: MapStyleOption =
    mapStyle === 'dark' ? 'roadmap' : mapStyle;

  const handleCopyJson = async (variant: 'light' | 'dark') => {
    const spec =
      variant === 'dark'
        ? PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE
        : PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE;
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopiedVariant(variant);
      setTimeout(() => setCopiedVariant(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadJson = (variant: 'light' | 'dark') => {
    const spec =
      variant === 'dark'
        ? PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE
        : PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE;
    const blob = new Blob([JSON.stringify(spec, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      variant === 'dark'
        ? 'printswift-midnight-discovery.dark.json'
        : 'printswift-neutral-discovery.light.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 outline-none overflow-x-hidden overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-settings-title"
    >
      <div className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl max-w-[calc(100vw-24px)] sm:max-w-2xl w-full max-h-[92dvh] overflow-x-hidden overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--ps-border)]">
          <div className="flex items-center gap-2 min-w-0">
            <Palette className="w-4 h-4 text-[var(--ps-text)] shrink-0" />
            <h2
              id="theme-settings-title"
              tabIndex={-1}
              className="text-base font-semibold text-[var(--ps-text)] outline-none truncate"
            >
              Website Appearance, Cloud Map Styling &amp; Units
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close appearance settings"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1.5 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-6">
          {/* A. Website Appearance Mode */}
          <div>
            <label className="block text-xs font-semibold text-[var(--ps-text)] mb-1">
              1. Website Appearance Mode (Decoupled from Map Appearance)
            </label>
            <p className="text-xs text-[var(--ps-text-muted)] mb-3">
              Controls the application shell, side panels, and workspaces (Light, Dark, or System). Changing the website appearance never alters the map&apos;s light or dark appearance.
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { id: 'system', label: 'System', icon: Monitor },
                  { id: 'light', label: 'Light Website', icon: Sun },
                  { id: 'dark', label: 'Dark Website', icon: Moon },
                ] as Array<{
                  id: AppearanceMode;
                  label: string;
                  icon: React.ComponentType<{ className?: string }>;
                }>
              ).map((item) => {
                const Icon = item.icon;
                const active = appearanceMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAppearanceMode(item.id)}
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* B. Colour Theme Presets */}
          <div>
            <label className="block text-xs font-semibold text-[var(--ps-text)] mb-1">
              2. Website Colour Theme Preset
            </label>
            <p className="text-xs text-[var(--ps-text-muted)] mb-3">
              Coordinated colour presets compatible with both Light and Dark website modes.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESETS.map((preset) => {
                const active = themePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setThemePreset(preset.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]/60'
                    }`}
                  >
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      <span
                        className="w-4 h-4 rounded-full border border-slate-300"
                        style={{ backgroundColor: preset.swatchBg }}
                      />
                      <span
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: preset.swatchAccent }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-[var(--ps-text)]">
                          {preset.name}
                        </span>
                        {active && (
                          <Check className="w-3.5 h-3.5 text-[var(--ps-text)]" />
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                        {preset.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* C. Independent Cloud Map Appearance (Neutral Discovery vs Midnight Discovery) */}
          <div className="p-4 rounded-xl bg-[var(--ps-surface-alt)]/50 border border-[var(--ps-border)] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <MapIcon className="w-4 h-4 text-[var(--ps-text)]" />
                <label className="text-xs font-semibold text-[var(--ps-text)]">
                  3. Independent Google Maps Cloud Appearance &amp; Base Layer
                </label>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)]">
                Active Map ID: {resolvedMapCfg.mapId}
              </span>
            </div>

            <p className="text-xs text-[var(--ps-text-muted)]">
              Switch independently between <strong>PrintSwift Neutral Discovery</strong> (Light) and <strong>PrintSwift Midnight Discovery</strong> (Dark), plus Roadmap, Satellite, Hybrid, and Terrain layers without resetting your map centre, zoom, selected listing, or drawn shapes.
            </p>

            {/* Light vs Dark Cloud Style Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {CLOUD_APPEARANCES.map((scheme) => {
                const isSelected = resolvedMapCfg.variant === scheme.id;
                return (
                  <button
                    key={scheme.id}
                    type="button"
                    onClick={() => setMapAppearance(scheme.id)}
                    className={`flex flex-col justify-between p-3 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-surface)] ring-2 ring-[var(--ps-ring)]/20'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-[var(--ps-text)]">
                          {scheme.name}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                          {scheme.subtitle}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-[var(--ps-text)] shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-[var(--ps-border)]">
                      <span
                        className="w-4 h-4 rounded border border-black/15"
                        style={{ backgroundColor: scheme.bgHex }}
                        title={`Background ${scheme.bgHex}`}
                      />
                      <span
                        className="w-4 h-4 rounded border border-black/15"
                        style={{ backgroundColor: scheme.landHex }}
                        title={`Land ${scheme.landHex}`}
                      />
                      <span
                        className="w-4 h-4 rounded border border-black/15"
                        style={{ backgroundColor: scheme.waterHex }}
                        title={`Water ${scheme.waterHex}`}
                      />
                      <span
                        className="w-4 h-4 rounded border border-black/15"
                        style={{ backgroundColor: scheme.roadHex }}
                        title={`Highway ${scheme.roadHex}`}
                      />
                      <span className="text-[10px] font-mono text-[var(--ps-text-muted)] ml-auto">
                        v1.0 Cloud JSON
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Base Map Type (Roadmap, Satellite, Hybrid, Terrain) */}
            <div>
              <div className="text-xs font-semibold text-[var(--ps-text)] mb-1.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>Map Type (Roadmap, Satellite, Hybrid, Terrain)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BASE_MAP_TYPES.map((typeItem) => {
                  const active = activeBaseType === typeItem.id;
                  return (
                    <button
                      key={typeItem.id}
                      type="button"
                      onClick={() => {
                        if (typeItem.id === 'roadmap') {
                          setMapStyle(
                            resolvedMapCfg.variant === 'dark' ? 'dark' : 'roadmap'
                          );
                        } else {
                          setMapStyle(typeItem.id);
                        }
                      }}
                      className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-surface)] font-semibold text-[var(--ps-text)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{typeItem.label}</span>
                        {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </div>
                      <div className="text-[10px] text-[var(--ps-text-muted)] font-normal mt-0.5 line-clamp-2">
                        {typeItem.note}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Configurable Cloud Map ID & Technical Notice */}
            <div className="pt-3 border-t border-[var(--ps-border)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--ps-text)] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Configurable Google Maps Cloud Map ID</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setShowJsonInspector((p) =>
                        p === 'light' ? 'none' : 'light'
                      )
                    }
                    className="px-2 py-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface)]"
                  >
                    {showJsonInspector === 'light'
                      ? 'Hide Light JSON'
                      : 'Inspect Light JSON'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setShowJsonInspector((p) =>
                        p === 'dark' ? 'none' : 'dark'
                      )
                    }
                    className="px-2 py-1 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface)]"
                  >
                    {showJsonInspector === 'dark'
                      ? 'Hide Dark JSON'
                      : 'Inspect Dark JSON'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-[var(--ps-text-muted)] mb-1">
                    Primary Map ID (Light &amp; Dark)
                  </label>
                  <input
                    type="text"
                    value={draftMapId}
                    onChange={(e) => setDraftMapId(e.target.value)}
                    placeholder="DEMO_MAP_ID"
                    aria-label="Primary Google Maps Map ID"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs font-mono text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[var(--ps-text-muted)] mb-1">
                    Optional Light Map ID Override
                  </label>
                  <input
                    type="text"
                    value={draftLightMapId}
                    onChange={(e) => setDraftLightMapId(e.target.value)}
                    placeholder="Uses Primary if blank"
                    aria-label="Light Variant Google Maps Map ID"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs font-mono text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[var(--ps-text-muted)] mb-1">
                    Optional Dark Map ID Override
                  </label>
                  <input
                    type="text"
                    value={draftDarkMapId}
                    onChange={(e) => setDraftDarkMapId(e.target.value)}
                    placeholder="Uses Primary if blank"
                    aria-label="Dark Variant Google Maps Map ID"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs font-mono text-[var(--ps-text)]"
                  />
                </div>
              </div>

              {mapIdValidationError && (
                <p
                  role="alert"
                  className="text-xs font-medium text-rose-600 dark:text-rose-400"
                >
                  {mapIdValidationError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isApplyingMapIds}
                    onClick={async () => {
                      const trimmedPrimary = draftMapId.trim();
                      if (!trimmedPrimary || !/^[A-Za-z0-9_-]{4,64}$/.test(trimmedPrimary)) {
                        setMapIdValidationError(
                          'Please enter a valid alphanumeric Google Maps Map ID (4–64 characters) or use DEMO_MAP_ID.'
                        );
                        return;
                      }
                      setMapIdValidationError(null);
                      setIsApplyingMapIds(true);
                      try {
                        await new Promise((resolve) => setTimeout(resolve, 250));
                        setConfiguredMapIds({
                          mapId: trimmedPrimary,
                          lightMapId: draftLightMapId,
                          darkMapId: draftDarkMapId,
                        });
                      } finally {
                        setIsApplyingMapIds(false);
                      }
                    }}
                    className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isApplyingMapIds && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>
                      {isApplyingMapIds
                        ? 'Applying…'
                        : 'Apply Map ID Configuration'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isApplyingMapIds}
                    onClick={() => {
                      setMapIdValidationError(null);
                      setDraftMapId('DEMO_MAP_ID');
                      setDraftLightMapId('');
                      setDraftDarkMapId('');
                      setConfiguredMapIds({
                        mapId: 'DEMO_MAP_ID',
                        lightMapId: '',
                        darkMapId: '',
                      });
                    }}
                    className="min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-60"
                  >
                    Use DEMO_MAP_ID Fallback
                  </button>
                </div>

                <label className="flex items-center gap-2 text-xs text-[var(--ps-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useVectorStylePreview}
                    onChange={(e) => setUseVectorStylePreview(e.target.checked)}
                  />
                  <span>Use Exact Cloud-JSON Vector Fallback Renderer</span>
                </label>
              </div>

              {/* Technical Notice on Google Maps Cloud-Based Styling */}
              <div className="p-3 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] text-[var(--ps-text-muted)] space-y-1.5 leading-relaxed">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--ps-text)]">
                  <Info className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  <span>
                    Google Maps Platform Cloud Styling Architecture Note
                  </span>
                </div>
                <p>
                  The supplied <strong>PrintSwift Neutral Discovery</strong> (<code>variant: &quot;light&quot;</code>) and <strong>PrintSwift Midnight Discovery</strong> (<code>variant: &quot;dark&quot;</code>) JSON configurations use the Google Cloud Console v2 cloud-based style format (<code>natural.land</code>, <code>infrastructure.roadNetwork.*</code>, <code>pointOfInterest.*</code>). Per Google Maps JS API requirements, cloud styles are never mixed with legacy <code>MapOptions.styles</code>; they are linked in Google Cloud Console to a <strong>Map ID</strong> and switched via <code>colorScheme: &quot;LIGHT&quot; | &quot;DARK&quot;</code>.
                </p>
                {resolvedMapCfg.isFallbackDemoMapId && (
                  <p className="text-amber-700 dark:text-amber-400 font-medium">
                    Currently using fallback <code>DEMO_MAP_ID</code>: Google Maps applies built-in <code>colorScheme: &quot;{resolvedMapCfg.colorScheme}&quot;</code> and PrintSwift canvas background <code>{resolvedMapCfg.backgroundColor}</code>. To render all 20 custom cloud feature rules on live Google tiles, associate the JSON below with your Cloud Console Map ID or toggle the <strong>Exact Cloud-JSON Vector Fallback Renderer</strong> above.
                  </p>
                )}
                {mapCloudFallbackNotice && (
                  <p className="text-amber-700 dark:text-amber-300 font-semibold">
                    Fallback Status: {mapCloudFallbackNotice}
                  </p>
                )}
              </div>

              {/* JSON Inspector & Download */}
              {showJsonInspector !== 'none' && (
                <div className="p-3 rounded-lg bg-slate-950 text-slate-100 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300">
                      {showJsonInspector === 'light'
                        ? 'PrintSwift Neutral Discovery (light.json)'
                        : 'PrintSwift Midnight Discovery (dark.json)'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopyJson(showJsonInspector)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px]"
                      >
                        <Copy className="w-3 h-3" />
                        <span>
                          {copiedVariant === showJsonInspector
                            ? 'Copied!'
                            : 'Copy JSON'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadJson(showJsonInspector)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px]"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download .json</span>
                      </button>
                    </div>
                  </div>
                  <pre className="text-[10px] font-mono max-h-44 overflow-y-auto p-2 rounded bg-slate-900 text-slate-300">
                    {JSON.stringify(
                      showJsonInspector === 'light'
                        ? PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE
                        : PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE,
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* D. Default Area Measurement Unit */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Ruler className="w-3.5 h-3.5 text-[var(--ps-text)]" />
              <label className="text-xs font-semibold text-[var(--ps-text)]">
                4. Area Display Unit (Canonical Default: Square Metres / m²)
              </label>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)] mb-2.5">
              All property and polygon measurements are stored canonically in square metres (m²) and converted cleanly for display.
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { id: 'sqm', label: 'm² (Default)' },
                  { id: 'sqft', label: 'ft²' },
                  { id: 'acre', label: 'Acres' },
                  { id: 'hectare', label: 'Hectares' },
                ] as Array<{ id: AreaUnit; label: string }>
              ).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setAreaUnit(u.id)}
                  className={`min-h-[44px] min-w-[44px] py-2 px-2.5 rounded-lg border text-xs font-medium transition-colors ${
                    areaUnit === u.id
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)]'
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Configurable Default Map Centre */}
          <div
            data-testid="default-map-center-settings"
            className="p-4 rounded-xl bg-[var(--ps-surface-alt)]/50 border border-[var(--ps-border)] space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-[var(--ps-text)]" />
                <label className="text-xs font-semibold text-[var(--ps-text)]">
                  5. Default Map Centre
                </label>
              </div>
              <span
                data-testid="default-center-status-badge"
                className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                  customDefaultCenter
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)]'
                }`}
              >
                {customDefaultCenter
                  ? 'Custom Centre Active'
                  : 'District Default (Churachandpur)'}
              </span>
            </div>

            <p className="text-xs text-[var(--ps-text-muted)]">
              Choose the initial map location for fresh sessions and when clicking the Return to Default Centre button. Panning or zooming the map will never overwrite your saved default.
            </p>

            <div className="p-2.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-mono text-[var(--ps-text-muted)] space-y-1">
              <div className="flex items-center justify-between">
                <span>Current Viewport Centre:</span>
                <span className="text-[var(--ps-text)] font-semibold">
                  {currentMapCenter.lat.toFixed(5)}°, {currentMapCenter.lng.toFixed(5)}°
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Configured Default:</span>
                {customDefaultCenter ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {customDefaultCenter.lat.toFixed(5)}°, {customDefaultCenter.lng.toFixed(5)}° (Custom)
                  </span>
                ) : (
                  <span>
                    24.33330°, 93.68330° (District Default)
                  </span>
                )}
              </div>
            </div>

            {saveCenterFeedback && (
              <div
                role="status"
                className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                <span>{saveCenterFeedback}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="save-current-center-as-default-btn"
                onClick={() => {
                  setCustomDefaultCenter(currentMapCenter);
                  setSaveCenterFeedback('Current map centre saved as your default!');
                  setTimeout(() => setSaveCenterFeedback(null), 3000);
                }}
                className="px-3.5 py-2 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5 min-h-[44px]"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Use Current Map Centre</span>
              </button>

              <button
                type="button"
                data-testid="reset-default-center-btn"
                disabled={!customDefaultCenter}
                onClick={() => {
                  resetCustomDefaultCenter();
                  setSaveCenterFeedback('Restored Churachandpur district default centre.');
                  setTimeout(() => setSaveCenterFeedback(null), 3000);
                }}
                className={`px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 min-h-[44px] ${
                  customDefaultCenter
                    ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] opacity-50 cursor-not-allowed'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to District Default</span>
              </button>
            </div>
          </div>

          {/* 6. Simple Mode Toggle */}
          <div
            data-testid="simple-mode-settings"
            className="p-4 rounded-xl bg-[var(--ps-surface-alt)]/50 border border-[var(--ps-border)] flex items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-[var(--ps-text)]" />
                <label
                  htmlFor="simple-mode-toggle"
                  className="text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                >
                  Simple Mode
                </label>
              </div>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Hides advanced drawing and measuring tools for a simplified map experience.
              </p>
            </div>
            <button
              id="simple-mode-toggle"
              type="button"
              role="switch"
              aria-checked={simpleMode}
              aria-label="Simple Mode"
              data-testid="simple-mode-toggle-btn"
              onClick={() => setSimpleMode(!simpleMode)}
              className={`relative inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-3 py-2 rounded-lg border text-xs font-semibold transition-colors shrink-0 ${
                simpleMode
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <span>{simpleMode ? 'On' : 'Off'}</span>
            </button>
          </div>

          {/* 7. Real Estate Mode Toggle */}
          <div
            data-testid="real-estate-mode-settings"
            className="p-4 rounded-xl bg-[var(--ps-surface-alt)]/50 border border-[var(--ps-border)] flex items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Home className="w-4 h-4 text-[var(--ps-text)]" />
                <label
                  htmlFor="real-estate-mode-toggle"
                  className="text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                >
                  Real Estate Mode
                </label>
              </div>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Focuses the map exclusively on property listings and plots.
              </p>
            </div>
            <button
              id="real-estate-mode-toggle"
              type="button"
              role="switch"
              aria-checked={isRealEstateMode}
              aria-label="Real Estate Mode"
              data-testid="real-estate-mode-toggle-btn"
              onClick={() => setRealEstateMode(!isRealEstateMode)}
              className={`relative inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-3 py-2 rounded-lg border text-xs font-semibold transition-colors shrink-0 ${
                isRealEstateMode
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <span>{isRealEstateMode ? 'On' : 'Off'}</span>
            </button>
          </div>

          {/* Synthetic Demo Dataset Disclosure */}
          <div
            data-testid="sample-data-disclosure-card"
            className="p-3.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] space-y-1.5 text-xs"
          >
            <div className="flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <span>Sample Dataset &amp; Prototype Notice</span>
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)] leading-relaxed">
              PrintSwift Local features a synthetic demonstration directory for Churachandpur (80 sample listings, product catalogues, and 360° property panoramas) to evaluate local discovery and geospatial workflows. It is a functional demonstration prototype, not a live commercial directory.
            </p>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-3.5 border-t border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--ps-surface-alt)]/40">
          <button
            type="button"
            onClick={() => {
              resetThemeToDefault();
              setMapAppearance('light');
              setMapStyle('roadmap');
              setAreaUnit('sqm');
              resetCustomDefaultCenter();
              setSimpleMode(false);
              setRealEstateMode(false);
            }}
            className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Theme, Map &amp; Units to Default</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] px-4 py-2 text-xs font-medium rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
